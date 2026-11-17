"""Descriptor-relative filesystem operations for preview preparation.

No source symlink is followed and no source regular inode is reused. Cache bytes
are copied into a new controller-private tree, never into a site-writable tree.
The delete operation is invoked with the old site's unprivileged UID.
"""

import errno
import json
import os
import stat
import sys

DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
REGULAR = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
CACHE_DIRECTORIES = {"node_modules", ".package-cache", ".home", ".corepack", ".cache", ".docusaurus", ".next"}
CACHE_FILES = {".pnp.cjs", ".pnp.js", ".pnp.loader.mjs", ".pnp.data.json"}
YARN_CACHE = {"cache", "unplugged", "install-state.gz", "build-state.yml"}
YARN_CONFIGURATION = {"plugins", "patches", "releases", "sdks"}
MAX_ENTRIES = 1_000_000
MAX_DEPTH = 128
CHUNK_BYTES = 1024 * 1024
RACE_ERRORS = {errno.ENOENT, errno.ENOTDIR, errno.ELOOP}


def open_directory(name, parent=None):
    return os.open(name, DIRECTORY, dir_fd=parent)


def entries(fd, state, depth, skip_git=True):
    if depth > MAX_DEPTH:
        raise RuntimeError("Preview tree exceeds the directory depth limit")
    names = os.listdir(fd)
    state["entries"] += len(names)
    if state["entries"] > MAX_ENTRIES:
        raise RuntimeError("Preview tree exceeds the entry limit")
    return [name for name in names if name not in {".", ".."} and (not skip_git or name != ".git")]


def copy_entry(source, destination, name, state, depth, prefer_existing=False):
    try:
        info = os.stat(name, dir_fd=source, follow_symlinks=False)
        if stat.S_ISLNK(info.st_mode):
            target = os.readlink(name, dir_fd=source)
            try:
                os.symlink(target, name, dir_fd=destination)
            except FileExistsError:
                if not prefer_existing:
                    state["complete"] = False
            return
        if stat.S_ISDIR(info.st_mode):
            src = open_directory(name, source)
            try:
                try:
                    os.mkdir(name, 0o700, dir_fd=destination)
                except FileExistsError:
                    pass
                dst = open_directory(name, destination)
                try:
                    for child in entries(src, state, depth, skip_git=False):
                        copy_entry(src, dst, child, state, depth + 1, prefer_existing)
                    os.fchmod(dst, info.st_mode & 0o777)
                    os.utime(dst, ns=(info.st_atime_ns, info.st_mtime_ns))
                finally:
                    os.close(dst)
            finally:
                os.close(src)
            return
        if not stat.S_ISREG(info.st_mode):
            state["complete"] = False
            return
        src = os.open(name, REGULAR, dir_fd=source)
        try:
            opened = os.fstat(src)
            # Reject links to any other inode namespace, including hardlinked secrets.
            if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1:
                state["complete"] = False
                return
            try:
                dst = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=destination)
            except FileExistsError:
                if not prefer_existing:
                    state["complete"] = False
                return
            try:
                while True:
                    block = os.read(src, CHUNK_BYTES)
                    if not block:
                        break
                    state["bytes"] += len(block)
                    if state["bytes"] > state["limit"]:
                        raise RuntimeError("Preview cache exceeds the copy budget")
                    view = memoryview(block)
                    while view:
                        view = view[os.write(dst, view):]
                os.fchmod(dst, opened.st_mode & 0o777)
                os.utime(dst, ns=(opened.st_atime_ns, opened.st_mtime_ns))
            finally:
                os.close(dst)
        finally:
            os.close(src)
    except OSError as error:
        if error.errno not in RACE_ERRORS:
            raise
        state["complete"] = False


def contains_cache(source, state, depth):
    for name in entries(source, state, depth):
        if name in CACHE_DIRECTORIES or name in CACHE_FILES or name == ".yarn":
            return True
        try:
            child = open_directory(name, source)
        except OSError as error:
            if error.errno in RACE_ERRORS:
                continue
            raise
        try:
            if contains_cache(child, state, depth + 1):
                return True
        finally:
            os.close(child)
    return False


def copy_caches(source, destination, state, depth=0, yarn=False):
    for name in entries(source, state, depth):
        try:
            info = os.stat(name, dir_fd=source, follow_symlinks=False)
            selected = name in CACHE_DIRECTORIES or name in CACHE_FILES or (yarn and name in YARN_CACHE | YARN_CONFIGURATION)
            if selected:
                copy_entry(source, destination, name, state, depth + 1, yarn and name in YARN_CONFIGURATION)
            elif stat.S_ISDIR(info.st_mode):
                src = open_directory(name, source)
                try:
                    # Never invent a tracked parent based on runtime-controlled names.
                    try:
                        if name == ".yarn":
                            try:
                                os.mkdir(name, 0o700, dir_fd=destination)
                            except FileExistsError:
                                pass
                        dst = open_directory(name, destination)
                    except OSError as error:
                        if error.errno in RACE_ERRORS:
                            if contains_cache(src, state, depth + 1):
                                state["complete"] = False
                            continue
                        raise
                    try:
                        copy_caches(src, dst, state, depth + 1, name == ".yarn")
                    finally:
                        os.close(dst)
                finally:
                    os.close(src)
        except OSError as error:
            if error.errno not in RACE_ERRORS:
                raise
            state["complete"] = False


def preserve_times(source, destination, state, depth=0):
    for name in entries(destination, state, depth):
        if name in CACHE_DIRECTORIES or name in CACHE_FILES:
            continue
        try:
            dst_info = os.stat(name, dir_fd=destination, follow_symlinks=False)
            if stat.S_ISDIR(dst_info.st_mode):
                src = open_directory(name, source)
                dst = open_directory(name, destination)
                try:
                    preserve_times(src, dst, state, depth + 1)
                finally:
                    os.close(src)
                    os.close(dst)
            elif stat.S_ISREG(dst_info.st_mode):
                src = os.open(name, REGULAR, dir_fd=source)
                dst = os.open(name, REGULAR, dir_fd=destination)
                try:
                    info = os.fstat(src)
                    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size != dst_info.st_size:
                        continue
                    same = True
                    while True:
                        left = os.read(src, CHUNK_BYTES)
                        right = os.read(dst, CHUNK_BYTES)
                        if left != right:
                            same = False
                            break
                        if not left:
                            break
                    if same:
                        os.utime(dst, ns=(info.st_atime_ns, info.st_mtime_ns))
                finally:
                    os.close(src)
                    os.close(dst)
        except OSError as error:
            if error.errno not in RACE_ERRORS:
                raise


def remove_entry(parent, name):
    try:
        child = open_directory(name, parent)
    except OSError as error:
        if error.errno in {errno.ENOTDIR, errno.ELOOP}:
            os.unlink(name, dir_fd=parent)
            return
        if error.errno == errno.ENOENT:
            return
        raise
    try:
        for entry in os.listdir(child):
            if entry not in {".", ".."}:
                remove_entry(child, entry)
    finally:
        os.close(child)
    os.rmdir(name, dir_fd=parent)


def prepare_cleanup(directory, uid, gid, state, depth=0):
    # Revoke writers before enumerating this directory, then descend only through
    # O_NOFOLLOW directory descriptors. Never change a regular file's ownership.
    if os.geteuid() == 0:
        os.fchown(directory, uid, gid)
    os.fchmod(directory, 0o700)
    for name in entries(directory, state, depth):
        try:
            child = open_directory(name, directory)
        except OSError as error:
            if error.errno in RACE_ERRORS:
                continue
            raise
        try:
            prepare_cleanup(child, uid, gid, state, depth + 1)
        finally:
            os.close(child)
    # Git metadata inside retired runtime trees is untrusted too, but is just data
    # for deletion. Include its directories in the same no-follow ownership walk.
    try:
        child = open_directory(".git", directory)
    except OSError as error:
        if error.errno not in RACE_ERRORS:
            raise
    else:
        try:
            prepare_cleanup(child, uid, gid, state, depth + 1)
        finally:
            os.close(child)


def main():
    operation, source = sys.argv[1:3]
    if operation == "prepare-cleanup":
        directory = open_directory(source)
        try:
            prepare_cleanup(directory, int(sys.argv[3]), int(sys.argv[4]), {"entries": 0})
        finally:
            os.close(directory)
        print(json.dumps({"complete": True, "bytes": 0}))
        return
    if operation == "clear":
        if os.geteuid() == 0:
            raise RuntimeError("Runtime trees must not be cleared as root")
        directory = open_directory(source)
        try:
            for name in os.listdir(directory):
                if name not in {".", ".."}:
                    remove_entry(directory, name)
        finally:
            os.close(directory)
        print(json.dumps({"complete": True, "bytes": 0}))
        return
    if operation in {"remove-file", "clear-package-cache", "clear-webpack-cache"}:
        if os.geteuid() == 0:
            raise RuntimeError("Runtime filesystem operations must not run as root")
        if operation == "remove-file":
            try:
                os.unlink(source)
            except FileNotFoundError:
                pass
        else:
            workspace = open_directory(source)
            relative = os.path.relpath(sys.argv[3], source)
            if relative == ".." or relative.startswith(".." + os.sep):
                raise RuntimeError("Runtime directory escapes its workspace")
            current = os.dup(workspace)
            try:
                components = [] if relative == "." else relative.split(os.sep)
                if operation == "clear-package-cache":
                    for length in range(len(components) + 1):
                        directory = os.dup(workspace)
                        try:
                            for component in components[:length]:
                                child = open_directory(component, directory)
                                os.close(directory)
                                directory = child
                            for name in (".pnp.cjs", ".pnp.js"):
                                try:
                                    os.stat(name, dir_fd=directory, follow_symlinks=False)
                                    print(json.dumps({"complete": True, "bytes": 0}))
                                    return
                                except FileNotFoundError:
                                    pass
                        finally:
                            os.close(directory)
                    parent = open_directory(".package-cache", workspace)
                    try:
                        remove_entry(parent, "yarn")
                    finally:
                        os.close(parent)
                else:
                    for component in components:
                        child = open_directory(component, current)
                        os.close(current)
                        current = child
                    cache = open_directory(".cache", current)
                    try:
                        remove_entry(cache, "pushdocs-webpack")
                    finally:
                        os.close(cache)
            except OSError as error:
                if error.errno in {errno.ENOTDIR, errno.ELOOP}:
                    raise RuntimeError("Каталог кеша не является папкой") from None
                if error.errno != errno.ENOENT:
                    raise
            finally:
                os.close(current)
                os.close(workspace)
        print(json.dumps({"complete": True, "bytes": 0}))
        return
    if operation == "remove":
        if os.geteuid() == 0:
            raise RuntimeError("Site-owned trees must not be deleted as root")
        parent = open_directory(os.path.dirname(source))
        try:
            remove_entry(parent, os.path.basename(source))
        finally:
            os.close(parent)
        print(json.dumps({"removed": True}))
        return
    destination = sys.argv[3]
    src = open_directory(source)
    dst = open_directory(destination)
    state = {"entries": 0, "bytes": 0, "limit": int(sys.argv[4]), "complete": True}
    try:
        if operation == "copy-caches":
            copy_caches(src, dst, state)
        elif operation == "preserve-times":
            preserve_times(src, dst, state)
        else:
            raise RuntimeError("Unknown private tree operation")
    finally:
        os.close(src)
        os.close(dst)
    print(json.dumps(state))


if __name__ == "__main__":
    main()

export function publicOrigin() {
  const value = process.env.PUSHDOCS_PUBLIC_ORIGIN;
  if (!value) throw new Error("PUSHDOCS_PUBLIC_ORIGIN is required for MCP");
  const url = new URL(value);
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw new Error("Invalid public origin");
  return url.origin;
}

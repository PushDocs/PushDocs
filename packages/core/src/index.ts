import type {
  DocumentSummary,
  ProjectRole,
  ProjectSummary,
  ProviderKind,
} from "@pushdocs/contracts";
import type { assertCan } from "@pushdocs/domain";

export interface Actor {
  id: string;
  isInstanceOperator: boolean;
}

export interface CoreRepository {
  createComment(input: {
    anchorQuote: string | null;
    body: string;
    branch: string;
    documentPath: string;
    projectId: string;
    userId: string;
  }): Promise<unknown>;
  createConnection(input: {
    baseUrl: string;
    kind: ProviderKind;
    name: string;
    secretEncrypted: string;
    vpnProfileEncrypted?: string;
  }): Promise<unknown>;
  createInvitation(input: {
    email: string;
    invitedByUserId: string;
    projectId: string;
    role: ProjectRole;
    tokenHash: string;
  }): Promise<unknown>;
  createProject(input: {
    connectionId: string;
    defaultBranch: string;
    name: string;
    operatorUserId: string;
    repositoryFullName: string;
    repositoryProviderId: string;
    repositoryUrl: string;
    rootPath: string;
    slug: string;
  }): Promise<unknown>;
  deleteConnection(connectionId: string): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
  listDocuments(projectId: string, branch: string): Promise<DocumentSummary[]>;
  listProjects(userId: string): Promise<ProjectSummary[]>;
  requireProjectAccess(
    userId: string,
    projectId: string,
    action?: Parameters<typeof assertCan>[1],
  ): Promise<{ role: ProjectRole }>;
  saveDraft(input: {
    baseCommitSha: string;
    branch: string;
    content: string;
    expectedRevision: number;
    path: string;
    projectId: string;
    userId: string;
  }): Promise<{ changeSetId: string; revision: number }>;
  updateConnection(input: {
    baseUrl: string;
    connectionId: string;
    name: string;
    secretEncrypted?: string;
    vpnProfileEncrypted?: string | null;
  }): Promise<unknown>;
  updateProject(input: {
    defaultBranch: string;
    name: string;
    projectId: string;
    rootPath: string;
    slug: string;
  }): Promise<unknown>;
}

export class PushDocs {
  constructor(private readonly repository: CoreRepository) {}

  listProjects(actor: Actor): Promise<ProjectSummary[]> {
    return this.repository.listProjects(actor.id);
  }

  async listDocuments(actor: Actor, projectId: string, branch: string) {
    await this.repository.requireProjectAccess(actor.id, projectId, "project:read");
    return this.repository.listDocuments(projectId, branch);
  }

  async saveDraft(
    actor: Actor,
    input: {
      baseCommitSha: string;
      branch: string;
      content: string;
      expectedRevision: number;
      path: string;
      projectId: string;
    },
  ) {
    await this.repository.requireProjectAccess(actor.id, input.projectId, "document:write");
    return this.repository.saveDraft({ ...input, userId: actor.id });
  }

  async createComment(
    actor: Actor,
    input: {
      anchorQuote: string | null;
      body: string;
      branch: string;
      documentPath: string;
      projectId: string;
    },
  ) {
    await this.repository.requireProjectAccess(actor.id, input.projectId, "comment:create");
    return this.repository.createComment({ ...input, userId: actor.id });
  }

  async inviteMember(
    actor: Actor,
    input: { email: string; projectId: string; role: ProjectRole; tokenHash: string },
  ) {
    await this.repository.requireProjectAccess(actor.id, input.projectId, "member:manage");
    return this.repository.createInvitation({
      ...input,
      invitedByUserId: actor.id,
    });
  }

  createProject(
    actor: Actor,
    input: Omit<Parameters<CoreRepository["createProject"]>[0], "operatorUserId">,
  ) {
    this.assertOperator(actor);
    return this.repository.createProject({ ...input, operatorUserId: actor.id });
  }

  createConnection(actor: Actor, input: Parameters<CoreRepository["createConnection"]>[0]) {
    this.assertOperator(actor);
    return this.repository.createConnection(input);
  }

  updateConnection(actor: Actor, input: Parameters<CoreRepository["updateConnection"]>[0]) {
    this.assertOperator(actor);
    return this.repository.updateConnection(input);
  }

  deleteConnection(actor: Actor, connectionId: string) {
    this.assertOperator(actor);
    return this.repository.deleteConnection(connectionId);
  }

  async updateProject(actor: Actor, input: Parameters<CoreRepository["updateProject"]>[0]) {
    await this.repository.requireProjectAccess(actor.id, input.projectId, "project:configure");
    return this.repository.updateProject(input);
  }

  async deleteProject(actor: Actor, projectId: string) {
    await this.repository.requireProjectAccess(actor.id, projectId, "project:configure");
    return this.repository.deleteProject(projectId);
  }

  private assertOperator(actor: Actor): void {
    if (!actor.isInstanceOperator) throw new Error("INSTANCE_OPERATOR_REQUIRED");
  }
}

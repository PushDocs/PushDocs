export enum BranchCreationStage {
  CheckingSource = "checking-source",
  CreatingBranch = "creating-branch",
  ImportingDocuments = "importing-documents",
}

export enum BranchCreationStatusFailure {
  AuthenticationRequired = "authentication-required",
  AccessDenied = "access-denied",
  NotFound = "not-found",
  Unavailable = "unavailable",
}

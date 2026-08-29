import type { ChallengeError } from '../../../web/src/challenge/contracts'

export class ChallengeApplicationError extends Error {
  constructor(readonly detail: ChallengeError) {
    super(detail.kind)
    this.name = 'ChallengeApplicationError'
  }
}

export class RepositoryConflictError extends Error {
  constructor() {
    super('The room was modified concurrently.')
    this.name = 'RepositoryConflictError'
  }
}

export class DuplicateRoomError extends Error {
  constructor() {
    super('The room identifier or code already exists.')
    this.name = 'DuplicateRoomError'
  }
}

export class DuplicateAnswerStorageError extends Error {
  constructor(readonly answerId: string) {
    super('The answer item already exists.')
    this.name = 'DuplicateAnswerStorageError'
  }
}

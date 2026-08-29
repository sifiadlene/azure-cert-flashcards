import { app } from '@azure/functions'
import { getExamRequestService } from '../application/examRequestComposition'
import { createExamRequestHandler } from '../http/examRequestHandler'

app.http('exam-request-create', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'exam-requests',
  handler: createExamRequestHandler(getExamRequestService),
})
// app/serverless/index.ts — superfície pública do @typer/serverless.

export {
  handleTask,
  createServer,
  lambdaHandler,
  type ServerlessRequest,
  type ServerlessResponse,
} from "./handler.js";

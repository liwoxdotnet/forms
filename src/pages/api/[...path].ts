import worker from "../../../worker/index";

export const prerender = false;

async function handle(context: any) {
  const env = context.locals.runtime.env;
  return worker.fetch(context.request, env);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
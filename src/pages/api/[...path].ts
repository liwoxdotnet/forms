import worker from "../../../worker/index";

export const prerender = false;

export async function ALL(context: any) {
  const env = context.locals.runtime.env;

  return worker.fetch(context.request, env);
}
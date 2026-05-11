export interface PostmanActivity {
  type: "activity";
  data: {
    text: string;
    sourceURL: string;
  };
}

export function activity(text: string, sourceURL: string): PostmanActivity {
  return {
    type: "activity",
    data: { text, sourceURL },
  };
}

export function workspaceActivity(ws: any, verb: "created" | "updated"): PostmanActivity {
  const url = `https://go.postman.co/workspace/${ws.id}`;
  return activity(
    `Workspace "${ws.name}" was ${verb} (visibility: ${ws.visibility ?? "unknown"}, type: ${ws.type ?? "workspace"})`,
    url
  );
}

export function collectionActivity(coll: any, verb: "created" | "updated"): PostmanActivity {
  const id = coll.uid ?? coll.id;
  const url = `https://go.postman.co/collection/${id}`;
  const owner = coll.owner ?? coll.createdBy ?? "someone";
  return activity(
    `Collection "${coll.name}" was ${verb} by ${owner}${
      coll.fork?.label ? ` (fork: ${coll.fork.label})` : ""
    }`,
    url
  );
}

export function environmentActivity(env: any, verb: "created" | "updated"): PostmanActivity {
  const id = env.uid ?? env.id;
  const url = `https://go.postman.co/environments/${id}`;
  return activity(`Environment "${env.name}" was ${verb}`, url);
}

export function apiActivity(api: any, verb: "created" | "updated"): PostmanActivity {
  const url = `https://go.postman.co/api/${api.id}`;
  return activity(`API "${api.name}" was ${verb}${api.summary ? `: ${api.summary}` : ""}`, url);
}

export function monitorRunActivity(monitor: any, run: any): PostmanActivity {
  const url = `https://go.postman.co/monitor/${monitor.uid ?? monitor.id}`;
  const stats = run.results?.stats ?? run.stats ?? {};
  const fail = stats.assertions?.failed ?? 0;
  const total = stats.assertions?.total ?? 0;
  const status = fail > 0 ? `${fail}/${total} assertions failed` : `all ${total} assertions passed`;
  return activity(
    `Monitor "${monitor.name}" ran — ${status}${run.startedAt ? ` at ${run.startedAt}` : ""}`,
    url
  );
}

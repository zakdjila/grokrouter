(async () => {
  const definitions = __GROKROUTER_NATIVE_SKILLS__;
  const operation = __GROKROUTER_NATIVE_OPERATION__;
  const markers = ["GROKROUTER_NATIVE_CONTROL:", "GROKROUTER_NATIVE_COMMAND:"];
  // Grok can restore the last conversation and its account-scoped workflow
  // library on different schedules. A cold diagnostic launch routinely needs
  // more than the old 12-second window even though the library becomes ready
  // moments later.
  const workflowReadyTimeoutMs = 45_000;
  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const withTimeout = (promise, milliseconds, label) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds)),
  ]);
  const withRetries = async (operation, label) => {
    let lastError;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        return await withTimeout(operation(), 5_000, label);
      } catch (error) {
        lastError = error;
        if (attempt < 4) await delay(attempt * 500);
      }
    }
    throw lastError || new Error(`${label} failed`);
  };

  function findAppContext() {
    const root = document.querySelector("#root");
    const containerKey = Object.keys(root || {}).find((key) => key.startsWith("__reactContainer$"));
    const queue = [root?.[containerKey]];
    const seen = new Set();
    while (queue.length > 0) {
      const fiber = queue.shift();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      for (let context = fiber.dependencies?.firstContext; context; context = context.next) {
        const value = context.memoizedValue;
        if (typeof value?.workflows?.install === "function"
          && typeof value?.workflows?.update === "function"
          && typeof value?.workflows?.remove === "function"
          && typeof value?.roster?.snapshots?.get === "function") {
          return value;
        }
      }
      queue.push(fiber.child, fiber.sibling);
    }
    return null;
  }

  async function waitForAppContext() {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const app = findAppContext();
      if (app) return app;
      await delay(100);
    }
    throw new Error("Grok Bot's workflow service is not ready");
  }

  async function waitForSelectedAgentId(app) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const snapshot = app.selection?.snapshots?.get?.();
      const selected = typeof app.selection?.readCurrentAgentId === "function"
        ? app.selection.readCurrentAgentId()
        : snapshot?.currentAgentId;
      if (typeof selected === "string" && selected && snapshot?.isLoadPending !== true) return selected;
      if (typeof app.selection?.waitForReady === "function") {
        // A selection can be superseded while Grok restores the last open Bot.
        // That is normal startup churn, not an installer failure.
        await Promise.race([app.selection.waitForReady().catch(() => {}), delay(250)]);
      } else {
        await delay(250);
      }
    }
    return "";
  }

  function workflowValue(snapshot) {
    if (Array.isArray(snapshot)) return snapshot;
    if (Array.isArray(snapshot?.value)) return snapshot.value;
    if (Array.isArray(snapshot?.rows)) return snapshot.rows;
    if (Array.isArray(snapshot?.data)) return snapshot.data;
    if (Array.isArray(snapshot?.data?.rows)) return snapshot.data.rows;
    if (snapshot?.status === "empty") return [];
    return null;
  }

  async function waitForWorkflows(store) {
    const immediate = workflowValue(store.get());
    if (immediate) return immediate;
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      let settled = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        callback();
      };
      const timer = setTimeout(
        () => finish(() => reject(new Error("workflow snapshot unavailable"))),
        workflowReadyTimeoutMs,
      );
      unsubscribe = store.subscribe(() => {
        const snapshot = store.get();
        const workflows = workflowValue(snapshot);
        if (workflows) {
          finish(() => resolve(workflows));
        }
      });
    });
  }

  function rosterAgents(app) {
    return (app.roster.snapshots.get()?.agents?.rows || [])
      .filter((agent) => typeof agent?.id === "string" && agent.id.length > 0);
  }

  async function waitForRosterAgents(app) {
    // Grok hydrates the roster after the selected Bot id is restored. On a
    // cold launch the first snapshot is routinely empty for a few seconds, so
    // an empty roster is startup timing until the deadline passes.
    const deadline = Date.now() + 20_000;
    let agents = rosterAgents(app);
    if (agents.length > 0) return agents;
    let notify = () => {};
    const unsubscribe = typeof app.roster.snapshots.subscribe === "function"
      ? app.roster.snapshots.subscribe(() => notify())
      : () => {};
    try {
      while (Date.now() < deadline) {
        await Promise.race([
          new Promise((resolve) => { notify = resolve; }),
          delay(250),
        ]);
        agents = rosterAgents(app);
        if (agents.length > 0) return agents;
      }
    } finally {
      notify = () => {};
      unsubscribe();
    }
    return agents;
  }

  const app = await waitForAppContext();
  const selectedAgentId = await waitForSelectedAgentId(app);
  const agents = await waitForRosterAgents(app);
  if (agents.length === 0) throw new Error("Grok Bot has no Bots or channels to register");

  // Grok Bot 0.30.0 exposes workflows through an agent-scoped API, but the
  // underlying workflow library is account-global. Installing once per roster
  // row produces suffixed duplicates (/provider-2, /provider-3, …) in every
  // channel picker. Use the active Bot as the API owner and reconcile the
  // global library exactly once.
  const candidates = [
    ...agents.filter((agent) => agent.id === selectedAgentId),
    ...agents.filter((agent) => agent.isActive),
    ...agents.filter((agent) => !agent.isGroup),
    ...agents,
  ].filter((agent, index, rows) => rows.findIndex((row) => row.id === agent.id) === index);
  let owner;
  let workflows;
  try {
    const available = await Promise.any(candidates.map(async (candidate) => ({
      owner: candidate,
      workflows: await waitForWorkflows(app.workflows.snapshotsFor(candidate.id)),
    })));
    owner = available.owner;
    workflows = available.workflows;
  } catch {
    throw new Error("Grok Bot's shared workflow library is unavailable");
  }
  if (!owner || !workflows) throw new Error("Grok Bot's shared workflow library is unavailable");

  const stats = {
    bots: agents.length,
    ownerId: owner.id,
    installed: 0,
    updated: 0,
    unchanged: 0,
    removed: 0,
    conflicts: 0,
    unavailable: 0,
    entries: definitions.length,
  };

  for (const definition of definitions) {
    const sameName = workflows.filter((workflow) =>
      String(workflow?.name || "").toLowerCase() === definition.name.toLowerCase());
    const owned = sameName.filter((workflow) => markers.some((marker) => String(workflow?.body || "").includes(marker))
      || (workflow.source === "workflow" && /GrokRouter/i.test(String(workflow.body || ""))));
    const conflicts = sameName.filter((workflow) => !owned.includes(workflow));
    const keep = operation === "sync" && conflicts.length === 0 ? owned[0] : null;

    for (const duplicate of owned) {
      if (duplicate === keep) continue;
      await withRetries(
        () => app.workflows.remove({ agentId: owner.id, workflowId: duplicate.id }),
        `remove duplicate /${definition.name}`,
      );
      stats.removed += 1;
    }

    if (operation === "remove") continue;
    if (conflicts.length > 0) {
      stats.conflicts += 1;
      continue;
    }
    if (keep) {
      const bodyMatches = String(keep.body || "").trim() === definition.body.trim();
      const descriptionMatches = String(keep.description || "").trim() === definition.description.trim();
      if (bodyMatches && descriptionMatches) {
        stats.unchanged += 1;
      } else {
        await withRetries(() => app.workflows.update({
          agentId: owner.id,
          workflowId: keep.id,
          spec: {
            name: definition.name,
            description: definition.description,
            body: definition.body,
            trigger: null,
            sourceRef: null,
          },
        }), `update /${definition.name}`);
        stats.updated += 1;
      }
    } else {
      await withRetries(() => app.workflows.install(owner.id, {
        install: { kind: "content", content: definition.markdown, name: definition.name },
      }), `install /${definition.name}`);
      stats.installed += 1;
    }
  }

  return JSON.stringify(stats);
})()

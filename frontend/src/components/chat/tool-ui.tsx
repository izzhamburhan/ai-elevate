"use client";

import { useState, type ReactNode } from "react";
import { useAui, type ToolCallMessagePartComponent, type ToolCallMessagePartProps } from "@assistant-ui/react";
import { AlertTriangleIcon, CheckCircle2Icon, ShieldAlertIcon, ShieldCheckIcon, ShieldXIcon } from "lucide-react";

import { ToolFallback } from "@/components/assistant-ui/elements/tool-fallback.aui";
import { Button } from "@/components/ui/button";
import { menaraData } from "@/lib/ai/tool-result";
import { OVERVIEW_REFRESH_EVENT } from "@/lib/network-overview";
import { cn } from "@/lib/utils";

/**
 * Tool calls whose result is shown as a card in the message instead of inside the collapsed
 * "N tool calls" group: the ones a NOC engineer must see, or has to act on.
 */
const CARD_TOOLS = new Set([
  "policy_check_action",
  "policy_list_approvals",
  "tower_get_alarms",
  "tower_list_in_bbox",
  "tower_list_in_radius",
]);

export const isCardTool = (toolName: string) => CARD_TOOLS.has(toolName);

const SEVERITY_STYLE: Record<string, string> = {
  CRITICAL: "bg-red-500/15 text-red-600 dark:text-red-400",
  MAJOR: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  MINOR: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  WARNING: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
};

const STATUS_STYLE: Record<string, string> = {
  DOWN: SEVERITY_STYLE.CRITICAL,
  DEGRADED: SEVERITY_STYLE.MAJOR,
  UNKNOWN: "bg-muted text-muted-foreground",
  UP: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

const SEVERITY_ORDER = ["CRITICAL", "MAJOR", "MINOR", "WARNING"];
const STATUS_ORDER = ["DOWN", "DEGRADED", "UNKNOWN", "UP"];

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("my-2 rounded-lg border bg-muted/30 p-3 text-sm", className)}>{children}</div>;
}

function Pill({ label, count, style }: { label: string; count: number; style?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", style)}>
      {label}
      <span className="tabular-nums">{count}</span>
    </span>
  );
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

function TruncatedNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="mt-2 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
      <AlertTriangleIcon className="size-3" /> Result was cut off by the server limit. Narrow the filter to see all.
    </p>
  );
}

type Alarm = { alarm_id: string; enodeb_name: string; code: string; severity: string; message: string };
type AlarmList = { alarms: Alarm[]; returned: number; truncated: boolean };

function AlarmsCard(props: ToolCallMessagePartProps) {
  const body = menaraData<AlarmList>(props.result);
  if (!body || !Array.isArray(body.data.alarms)) return <ToolFallback {...props} />;
  const { alarms, truncated } = body.data;
  const bySeverity = countBy(alarms, (a) => a.severity);
  const towers = new Set(alarms.map((a) => a.enodeb_name)).size;
  const rows = alarms.slice(0, 5);

  return (
    <Card>
      <p className="font-medium">
        {alarms.length} active alarm{alarms.length === 1 ? "" : "s"} on {towers} tower{towers === 1 ? "" : "s"}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {SEVERITY_ORDER.filter((s) => bySeverity[s]).map((s) => (
          <Pill key={s} label={s} count={bySeverity[s]} style={SEVERITY_STYLE[s]} />
        ))}
      </div>
      {rows.length > 0 && (
        <ul className="mt-2 divide-y divide-border/60 text-xs">
          {rows.map((a) => (
            <li key={a.alarm_id} className="flex items-baseline gap-2 py-1">
              <span className={cn("rounded px-1 font-medium", SEVERITY_STYLE[a.severity])}>{a.severity[0]}</span>
              <span className="font-mono">{a.enodeb_name}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{a.message || a.code}</span>
            </li>
          ))}
        </ul>
      )}
      {alarms.length > rows.length && (
        <p className="mt-1 text-xs text-muted-foreground">+{alarms.length - rows.length} more</p>
      )}
      <TruncatedNote show={truncated} />
    </Card>
  );
}

type Tower = { enodeb_name: string; town: string; state: string; status: string; distance_km?: number };
type TowerList = { towers: Tower[]; returned: number; truncated: boolean };

function TowerListCard(props: ToolCallMessagePartProps) {
  const body = menaraData<TowerList>(props.result);
  if (!body || !Array.isArray(body.data.towers)) return <ToolFallback {...props} />;
  const { towers, truncated } = body.data;
  const byStatus = countBy(towers, (t) => t.status);
  const worst = [...towers]
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
    .filter((t) => t.status !== "UP")
    .slice(0, 5);

  return (
    <Card>
      <p className="font-medium">
        {towers.length} tower{towers.length === 1 ? "" : "s"} found
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {STATUS_ORDER.filter((s) => byStatus[s]).map((s) => (
          <Pill key={s} label={s} count={byStatus[s]} style={STATUS_STYLE[s]} />
        ))}
      </div>
      {worst.length > 0 && (
        <ul className="mt-2 divide-y divide-border/60 text-xs">
          {worst.map((t) => (
            <li key={t.enodeb_name} className="flex items-baseline gap-2 py-1">
              <span className={cn("rounded px-1 font-medium", STATUS_STYLE[t.status])}>{t.status}</span>
              <span className="font-mono">{t.enodeb_name}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {t.town}, {t.state}
              </span>
            </li>
          ))}
        </ul>
      )}
      <TruncatedNote show={truncated} />
    </Card>
  );
}

type PolicyDecision = {
  action: string;
  targets: string[];
  decision: "allow" | "ask" | "deny";
  reason: string;
  rules: { rule: string; passed: boolean; detail: string }[];
  affected_subscribers: number;
  touches_emergency: boolean;
  approval_id: string | null;
};

type Decided = { decision: "approve" | "reject"; approver: string };

const APPROVER_KEY = "elevate.approver";
const decidedKey = (approvalId: string) => `elevate.approval.${approvalId}`;

function readStored<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked: the card still works for this session
  }
}

const targetsText = (d: PolicyDecision) => d.targets.join(", ");

type ApprovalRef = { approvalId: string; action: string; target: string };

/** Pending approval: only a person can decide; the key lives on the server (`/api/policy/decide`). */
function ApprovalActions({ approval }: { approval: ApprovalRef }) {
  const aui = useAui();
  const { approvalId } = approval;
  const [decided, setDecided] = useState<Decided | undefined>(() => readStored<Decided>(decidedKey(approvalId)));
  const [approver, setApprover] = useState(() => readStored<string>(APPROVER_KEY) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function decide(decision: Decided["decision"]) {
    const name = approver.trim();
    if (!name) {
      setError("Enter your name first.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/policy/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, decision, approver: name }),
      });
      const body = (await res.json()) as { error?: string; token?: string };
      if (!res.ok) throw new Error(body.error ?? "Decision failed.");

      writeStored(APPROVER_KEY, name);
      writeStored(decidedKey(approvalId), { decision, approver: name } satisfies Decided);
      setDecided({ decision, approver: name });

      // tell the agent; the signed token is what the RAN server checks for this exact action and towers
      const text =
        decision === "approve" && body.token
          ? `Approval ${approvalId} was approved by ${name}. Policy token for ${approval.action} on ${approval.target}: ${body.token}\nApply the change with this token, then verify the KPIs.`
          : `Approval ${approvalId} was rejected by ${name}. Do not make this change. Suggest an alternative.`;
      aui.thread().append(text);
      window.dispatchEvent(new Event(OVERVIEW_REFRESH_EVENT));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decision failed.");
    } finally {
      setBusy(false);
    }
  }

  if (decided) {
    const approved = decided.decision === "approve";
    return (
      <p className={cn("mt-3 text-xs font-medium", approved ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
        {approved ? "Approved" : "Rejected"} by {decided.approver}
      </p>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input
        value={approver}
        onChange={(e) => setApprover(e.target.value)}
        placeholder="Your name"
        maxLength={60}
        aria-label="Approver name"
        className="h-8 w-36 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <Button size="sm" disabled={busy} onClick={() => void decide("approve")}>
        Approve
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void decide("reject")}>
        Reject
      </Button>
      {error && <p className="w-full text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function PolicyDecisionCard(props: ToolCallMessagePartProps) {
  const body = menaraData<PolicyDecision>(props.result);
  if (!body || !body.data.decision) return <ToolFallback {...props} />;
  const policy = body.data;
  const failed = policy.rules?.filter((r) => !r.passed) ?? [];

  const view = {
    allow: { Icon: ShieldCheckIcon, title: "Allowed by policy", tone: "text-emerald-600 dark:text-emerald-400" },
    ask: { Icon: ShieldAlertIcon, title: "Needs human approval", tone: "text-amber-600 dark:text-amber-400" },
    deny: { Icon: ShieldXIcon, title: "Blocked by policy", tone: "text-red-600 dark:text-red-400" },
  }[policy.decision];

  return (
    <Card className={policy.decision === "ask" ? "border-amber-500/50" : undefined}>
      <p className={cn("flex items-center gap-1.5 font-medium", view.tone)}>
        <view.Icon className="size-4" /> {view.title}
      </p>
      <p className="mt-1.5">
        <span className="font-mono text-xs">{policy.action}</span> on{" "}
        <span className="font-mono text-xs">{targetsText(policy)}</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {policy.affected_subscribers.toLocaleString()} subscribers affected
        {policy.touches_emergency ? " · touches emergency services" : ""}
      </p>
      <p className="mt-1.5 text-xs">{policy.reason}</p>
      {failed.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
          {failed.map((r) => (
            <li key={r.rule}>{r.detail}</li>
          ))}
        </ul>
      )}
      {policy.decision === "ask" && policy.approval_id && (
        <ApprovalActions approval={{ approvalId: policy.approval_id, action: policy.action, target: targetsText(policy) }} />
      )}
      {policy.decision === "allow" && (
        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <CheckCircle2Icon className="size-3" /> Auto-approved {policy.approval_id}
        </p>
      )}
    </Card>
  );
}

type ApprovalRow = {
  approval_id: string;
  action: string;
  target: string;
  status: string;
  confidence: number;
  affected_subscribers: number;
  touches_emergency: boolean;
  reason: string;
  decided_by: string | null;
};

/** The approvals inbox: every pending one can be decided right here. */
function ApprovalListCard(props: ToolCallMessagePartProps) {
  const body = menaraData<{ approvals: ApprovalRow[] }>(props.result);
  if (!body || !Array.isArray(body.data.approvals)) return <ToolFallback {...props} />;
  const rows = body.data.approvals;
  if (rows.length === 0) {
    return (
      <Card>
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <CheckCircle2Icon className="size-4" /> No approvals match.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <p className="font-medium">
        {rows.length} approval{rows.length === 1 ? "" : "s"}
      </p>
      <ul className="mt-2 space-y-3">
        {rows.map((a) => (
          <li key={a.approval_id} className="border-t border-border/60 pt-2 first:border-t-0 first:pt-0">
            <p className="text-xs">
              <span className="font-mono">{a.approval_id}</span> ·{" "}
              <span className="font-mono">{a.action}</span> on <span className="font-mono">{a.target}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {a.affected_subscribers.toLocaleString()} subscribers · confidence {Math.round(a.confidence * 100)}%
              {a.touches_emergency ? " · emergency services" : ""}
            </p>
            <p className="mt-0.5 text-xs">{a.reason}</p>
            {a.status === "PENDING" ? (
              <ApprovalActions approval={{ approvalId: a.approval_id, action: a.action, target: a.target }} />
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                {a.status}
                {a.decided_by ? ` by ${a.decided_by}` : ""}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

const CARDS: Record<string, ToolCallMessagePartComponent> = {
  policy_check_action: PolicyDecisionCard,
  policy_list_approvals: ApprovalListCard,
  tower_get_alarms: AlarmsCard,
  tower_list_in_bbox: TowerListCard,
  tower_list_in_radius: TowerListCard,
};

/**
 * Tool-call renderer: a compact card for the tools above, the generic collapsible for the rest
 * (and for any card tool that is still running or returned something unexpected).
 */
export const ChatToolCall: ToolCallMessagePartComponent = (props) => {
  const Component = CARDS[props.toolName];
  if (!Component || props.result === undefined) return <ToolFallback {...props} />;
  return <Component {...props} />;
};

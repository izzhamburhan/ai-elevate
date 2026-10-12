"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UnplugIcon,
  WrenchIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { findBuiltinConnector } from "@/lib/ai/mcp-catalog";
import { cn } from "@/lib/utils";

import {
  useConnectors,
  type Connector,
  type ConnectorStatus,
  type ConnectorTransport,
  type NewConnector,
} from "./connectors-store";

export type ConnectorsView =
  | { name: "list" }
  | { name: "detail"; id: string }
  | { name: "add" }
  | { name: "edit"; id: string };

type ConnectorsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** View to show when the dialog opens. */
  initialView?: ConnectorsView;
};

/** Claude-desktop-style "Connectors" settings: list, per-connector tools, add/edit form. */
export function ConnectorsDialog({ open, onOpenChange, initialView }: ConnectorsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* kepler's side panel sits at z-index 99, its menus up to 1000 */}
      <DialogContent
        overlayClassName="z-[1100]"
        className="z-[1100] flex max-h-[min(640px,calc(100svh-2rem))] flex-col gap-0 overflow-hidden p-0 font-sans sm:max-w-xl"
      >
        {/* mounted per open, so navigation state resets each time */}
        <DialogBody initialView={initialView ?? { name: "list" }} />
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({ initialView }: { initialView: ConnectorsView }) {
  const [view, setView] = useState<ConnectorsView>(initialView);

  useEffect(() => {
    // connect to anything not yet checked in this session
    const { connectors, status, refresh } = useConnectors.getState();
    connectors.filter((c) => !status[c.id]).forEach((c) => void refresh(c.id));
  }, []);

  return (
    <>
      {view.name === "list" ? <ListView onNavigate={setView} /> : null}
        {view.name === "detail" ? (
          <DetailView id={view.id} onNavigate={setView} />
        ) : null}
        {view.name === "add" ? (
          <FormView onBack={() => setView({ name: "list" })} onSaved={(id) => setView({ name: "detail", id })} />
        ) : null}
        {view.name === "edit" ? (
          <FormView
            id={view.id}
            onBack={() => setView({ name: "detail", id: view.id })}
            onSaved={(id) => setView({ name: "detail", id })}
          />
        ) : null}
    </>
  );
}

/* ------------------------------------------------------------------------------------ */

function ListView({ onNavigate }: { onNavigate: (view: ConnectorsView) => void }) {
  const connectors = useConnectors((s) => s.connectors);
  const builtins = connectors.filter((c) => c.builtin);
  const custom = connectors.filter((c) => !c.builtin);

  return (
    <>
      <DialogHeader className="border-b px-5 pt-5 pb-4">
        <DialogTitle className="text-lg font-semibold">Connectors</DialogTitle>
        <DialogDescription>
          Connect remote MCP servers so the assistant can use their tools in this chat.
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {builtins.length ? (
          <ConnectorSection title="Built-in" connectors={builtins} onNavigate={onNavigate} />
        ) : null}
        {custom.length ? (
          <ConnectorSection title="Custom" connectors={custom} onNavigate={onNavigate} />
        ) : (
          <EmptyState onAdd={() => onNavigate({ name: "add" })} />
        )}
      </div>

      <DialogFooter className="m-0 flex-row items-center justify-between rounded-none px-5 py-3 sm:justify-between">
        <p className="py-1.5 text-xs text-muted-foreground">Stored in this browser only.</p>
        {custom.length ? (
          <Button variant="outline" onClick={() => onNavigate({ name: "add" })}>
            <PlusIcon />
            Add custom connector
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}

function ConnectorSection({
  title,
  connectors,
  onNavigate,
}: {
  title: string;
  connectors: Connector[];
  onNavigate: (view: ConnectorsView) => void;
}) {
  return (
    <section className="mb-2">
      <h3 className="px-2 pt-1 pb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <ul className="flex flex-col gap-1">
        {connectors.map((c) => (
          <li key={c.id}>
            <ConnectorRow connector={c} onOpen={() => onNavigate({ name: "detail", id: c.id })} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mx-2 mt-2 flex items-center gap-3 rounded-lg border border-dashed px-3 py-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <UnplugIcon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium">Connect your own MCP server</p>
        <p className="text-[13px] text-muted-foreground">Any remote MCP server reachable over HTTP.</p>
      </div>
      <Button size="sm" variant="outline" onClick={onAdd}>
        <PlusIcon />
        Add
      </Button>
    </div>
  );
}

function ConnectorRow({ connector, onOpen }: { connector: Connector; onOpen: () => void }) {
  const status = useConnectors((s) => s.status[connector.id]);
  const update = useConnectors((s) => s.update);

  return (
    <div className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none"
      >
        <ConnectorAvatar connector={connector} status={status} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{connector.name}</p>
          <StatusLine connector={connector} status={status} />
        </div>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
      <Switch
        checked={connector.enabled}
        onCheckedChange={(enabled) => update(connector.id, { enabled })}
        aria-label={`Use ${connector.name} in chat`}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------ */

function DetailView({ id, onNavigate }: { id: string; onNavigate: (view: ConnectorsView) => void }) {
  const connector = useConnectors((s) => s.connectors.find((c) => c.id === id));
  const status = useConnectors((s) => s.status[id]);
  const { update, remove, refresh, toggleTool, setAllTools } = useConnectors.getState();
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (!connector) return <ListView onNavigate={onNavigate} />;

  const catalogEntry = connector.builtin ? findBuiltinConnector(connector.id) : undefined;
  const tools = status?.state === "connected" ? status.inspection.tools : [];
  const disabled = new Set(connector.disabledTools);
  const enabledCount = tools.filter((t) => !disabled.has(t.name)).length;

  return (
    <>
      <div className="flex items-start gap-3 border-b px-5 pt-4 pb-4 pr-12">
        <Button
          variant="ghost"
          size="icon-sm"
          className="-ml-2 shrink-0"
          aria-label="Back to connectors"
          onClick={() => onNavigate({ name: "list" })}
        >
          <ArrowLeftIcon />
        </Button>
        <ConnectorAvatar connector={connector} status={status} size="lg" />
        <div className="min-w-0 flex-1">
          <DialogTitle className="truncate text-lg font-semibold">{connector.name}</DialogTitle>
          <DialogDescription className="truncate font-mono text-xs">{connector.url}</DialogDescription>
          {catalogEntry ? (
            <p className="mt-1.5 text-[13px] text-muted-foreground">{catalogEntry.description}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {connector.builtin ? <Badge variant="brand">Built-in</Badge> : null}
            <StatusBadge status={status} />
            <Badge variant="outline">{connector.transport === "sse" ? "SSE" : "Streamable HTTP"}</Badge>
            {status?.state === "connected" && status.inspection.serverVersion ? (
              <Badge variant="outline">
                {status.inspection.serverName} v{status.inspection.serverVersion}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between gap-4 px-5 py-3">
          <div>
            <p className="font-medium">Use in chat</p>
            <p className="text-[13px] text-muted-foreground">
              Offer this connector&apos;s tools to the assistant.
            </p>
          </div>
          <Switch
            checked={connector.enabled}
            onCheckedChange={(enabled) => update(id, { enabled })}
            aria-label="Use in chat"
          />
        </div>

        {status?.state === "error" ? (
          <div className="mx-5 mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[13px] text-destructive">
            <p className="font-medium">Couldn&apos;t connect</p>
            <p className="mt-0.5 break-words text-destructive/80">{status.error}</p>
            {catalogEntry?.setupHint ? (
              <>
                <p className="mt-2 text-foreground">Start the server, then reconnect:</p>
                <code className="mt-1 block rounded-md bg-muted px-2 py-1.5 font-mono text-xs text-foreground">
                  {catalogEntry.setupHint}
                </code>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="border-t px-5 pt-3 pb-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Tools {tools.length ? `· ${enabledCount}/${tools.length} enabled` : ""}
            </p>
            {tools.length ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setAllTools(id, enabledCount < tools.length)}
              >
                {enabledCount < tools.length ? "Enable all" : "Disable all"}
              </Button>
            ) : null}
          </div>

          {status?.state === "connecting" || !status ? (
            <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Loading tools…
            </div>
          ) : tools.length === 0 ? (
            <p className="py-6 text-[13px] text-muted-foreground">
              {status.state === "error" ? "Tools are unavailable until the server is reachable." : "This server exposes no tools."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
              {tools.map((tool) => (
                <li key={tool.name} className="flex items-start gap-3 px-3 py-2.5">
                  <WrenchIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">
                      {tool.title ?? tool.name}
                      {tool.title ? (
                        <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">
                          {tool.name}
                        </span>
                      ) : null}
                    </p>
                    {tool.description ? (
                      <p className="line-clamp-2 text-xs text-muted-foreground">{tool.description}</p>
                    ) : null}
                  </div>
                  <Switch
                    size="sm"
                    className="mt-0.5"
                    checked={!disabled.has(tool.name)}
                    onCheckedChange={(on) => toggleTool(id, tool.name, on)}
                    aria-label={`Allow ${tool.name}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <DialogFooter className="m-0 flex-row items-center justify-between rounded-none px-5 py-3 sm:justify-between">
        {connector.builtin ? (
          <p className="py-1.5 text-xs text-muted-foreground">Built-in connectors can be switched off, not removed.</p>
        ) : confirmRemove ? (
          <div className="flex items-center gap-2">
            <span className="text-[13px]">Remove this connector?</span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                remove(id);
                onNavigate({ name: "list" });
              }}
            >
              Remove
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmRemove(true)}>
            <Trash2Icon />
            Remove
          </Button>
        )}
        <div className="flex items-center gap-2">
          {connector.builtin ? null : (
            <Button variant="outline" size="sm" onClick={() => onNavigate({ name: "edit", id })}>
              Edit
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={status?.state === "connecting"}
            onClick={() => void refresh(id)}
          >
            <RefreshCwIcon className={cn(status?.state === "connecting" && "animate-spin")} />
            Reconnect
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

/* ------------------------------------------------------------------------------------ */

function FormView({
  id,
  onBack,
  onSaved,
}: {
  id?: string;
  onBack: () => void;
  onSaved: (id: string) => void;
}) {
  const existing = useConnectors((s) => (id ? s.connectors.find((c) => c.id === id) : undefined));
  const { add, update } = useConnectors.getState();

  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [transport, setTransport] = useState<ConnectorTransport>(existing?.transport ?? "http");
  const [authToken, setAuthToken] = useState(existing?.authToken ?? "");
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(existing?.authToken || existing?.transport === "sse"));
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
      if (!/^https?:$/.test(parsed.protocol)) throw new Error();
    } catch {
      setError("Enter a valid http:// or https:// URL.");
      return;
    }
    const values: NewConnector = {
      name: name.trim() || parsed.hostname,
      url: parsed.toString(),
      transport,
      authToken: authToken.trim() || undefined,
    };
    if (existing) {
      update(existing.id, values);
      onSaved(existing.id);
    } else {
      onSaved(add(values));
    }
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-center gap-2 border-b px-5 pt-4 pb-4 pr-12">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="-ml-2"
          aria-label="Back"
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
        <DialogHeader className="gap-1">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            {existing ? "Edit connector" : "Add custom connector"}
            <Badge variant="brand">MCP</Badge>
          </DialogTitle>
          <DialogDescription>Connect a remote MCP server over HTTP.</DialogDescription>
        </DialogHeader>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <Field label="Name" htmlFor="connector-name">
          <Input
            id="connector-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="NetOps"
            autoComplete="off"
          />
        </Field>

        <Field label="Remote MCP server URL" htmlFor="connector-url">
          <Input
            id="connector-url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder="http://localhost:8000/mcp"
            autoComplete="off"
            autoFocus
            aria-invalid={error ? true : undefined}
            className="font-mono text-[13px]"
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </Field>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
            <ChevronDownIcon className={cn("size-4 transition-transform", !advancedOpen && "-rotate-90")} />
            Advanced settings
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 flex flex-col gap-4">
            <Field label="Transport">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["http", "Streamable HTTP", "Current MCP spec"],
                    ["sse", "HTTP + SSE", "Legacy servers"],
                  ] as const
                ).map(([value, label, hint]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTransport(value)}
                    aria-pressed={transport === value}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left transition-colors",
                      transport === value
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/60",
                    )}
                  >
                    <p className="text-[13px] font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{hint}</p>
                  </button>
                ))}
              </div>
            </Field>

            <Field
              label="Bearer token"
              htmlFor="connector-token"
              hint="Optional. Sent as the Authorization header."
            >
              <Input
                id="connector-token"
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                autoComplete="off"
              />
            </Field>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <DialogFooter className="m-0 rounded-none px-5 py-3">
        <Button type="button" variant="ghost" onClick={onBack}>
          Cancel
        </Button>
        <Button type="submit" disabled={!url.trim()}>
          {existing ? "Save" : "Add"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------ */

export function ConnectorAvatar({
  connector,
  status,
  size = "md",
}: {
  connector: Connector;
  status: ConnectorStatus | undefined;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <div
      className={cn(
        "relative grid shrink-0 place-items-center rounded-lg bg-muted font-semibold text-muted-foreground uppercase",
        size === "sm" && "size-6 rounded-md text-[11px]",
        size === "md" && "size-9 text-sm",
        size === "lg" && "size-11 text-base",
        !connector.enabled && "opacity-50",
      )}
    >
      {connector.name.slice(0, 1)}
      <span
        aria-hidden
        className={cn(
          "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-popover",
          !status || status.state === "connecting"
            ? "bg-muted-foreground/40"
            : status.state === "connected"
              ? "bg-emerald-500"
              : "bg-destructive",
        )}
      />
    </div>
  );
}

function StatusLine({ connector, status }: { connector: Connector; status: ConnectorStatus | undefined }) {
  if (!status || status.state === "connecting") {
    return <p className="truncate text-xs text-muted-foreground">Connecting…</p>;
  }
  if (status.state === "error") {
    return <p className="truncate text-xs text-destructive">Couldn&apos;t connect · {connector.url}</p>;
  }
  const total = status.inspection.tools.length;
  const enabled = total - connector.disabledTools.filter((t) => status.inspection.tools.some((x) => x.name === t)).length;
  return (
    <p className="truncate text-xs text-muted-foreground">
      {enabled === total ? `${total} tools` : `${enabled} of ${total} tools`} · {connector.url}
    </p>
  );
}

function StatusBadge({ status }: { status: ConnectorStatus | undefined }) {
  if (!status || status.state === "connecting") {
    return (
      <Badge variant="secondary">
        <Loader2Icon className="animate-spin" />
        Connecting
      </Badge>
    );
  }
  if (status.state === "error") return <Badge variant="destructive">Error</Badge>;
  return (
    <Badge variant="secondary" className="text-emerald-700 dark:text-emerald-400">
      <span className="size-1.5 rounded-full bg-emerald-500" />
      Connected
    </Badge>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BadgeCheckIcon,
  CheckIcon,
  ChevronDownIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
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
import {
  CONNECTOR_CATEGORIES,
  findBuiltinConnector,
  type BuiltinConnector,
  type ConnectorCategory,
} from "@/lib/ai/mcp-catalog";
import { cn } from "@/lib/utils";

import { CONNECTOR_ICONS } from "./connector-icons";
import {
  useConnectors,
  type Connector,
  type ConnectorStatus,
  type ConnectorTransport,
  type NewConnector,
} from "./connectors-store";

export type ConnectorsView =
  | { name: "list" }
  | { name: "category"; id: ConnectorCategory }
  | { name: "detail"; id: string }
  | { name: "add" }
  | { name: "edit"; id: string };

type Nav = {
  go: (view: ConnectorsView) => void;
  /** Swap the current view, so Back skips it. */
  replace: (view: ConnectorsView) => void;
  back: () => void;
  reset: (view: ConnectorsView) => void;
};

type ConnectorsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** View to show when the dialog opens. */
  initialView?: ConnectorsView;
};

/** How many cards a topic shows before "Show all". */
const SECTION_PREVIEW = 4;

const DATA_LABEL: Record<BuiltinConnector["data"], string> = {
  synthetic: "Synthetic",
  real: "Real data",
  experimental: "Experimental",
  live: "Live map",
};

/** Claude-style "Connectors" directory: a topic-grouped catalog, per-connector tools, add/edit. */
export function ConnectorsDialog({ open, onOpenChange, initialView }: ConnectorsDialogProps) {
  const [stack, setStack] = useState<ConnectorsView[]>([initialView ?? { name: "list" }]);
  const [query, setQuery] = useState("");
  const [prevOpen, setPrevOpen] = useState(open);

  // navigation and search start fresh each time the dialog opens
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setStack([initialView ?? { name: "list" }]);
      setQuery("");
    }
  }

  useEffect(() => {
    if (!open) return;
    // connect to anything not yet checked in this session
    const { connectors, status, refresh } = useConnectors.getState();
    connectors.filter((c) => !status[c.id]).forEach((c) => void refresh(c.id));
  }, [open]);

  const view = stack[stack.length - 1];
  const wide = view.name === "list" || view.name === "category";
  const nav: Nav = {
    go: (next) => setStack((s) => [...s, next]),
    replace: (next) => setStack((s) => [...s.slice(0, -1), next]),
    back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : [{ name: "list" }])),
    reset: (next) => setStack([next]),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* kepler's side panel sits at z-index 99, its menus up to 1000 */}
      <DialogContent
        overlayClassName="z-[1100]"
        className={cn(
          "z-[1100] flex flex-col gap-0 overflow-hidden p-0 font-sans",
          wide
            ? "h-[min(760px,calc(100svh-2rem))] rounded-2xl sm:max-w-4xl"
            : "max-h-[min(640px,calc(100svh-2rem))] sm:max-w-xl",
        )}
      >
        {view.name === "list" ? (
          <ListView query={query} onQueryChange={setQuery} nav={nav} />
        ) : null}
        {view.name === "category" ? <CategoryView id={view.id} nav={nav} /> : null}
        {view.name === "detail" ? <DetailView id={view.id} nav={nav} /> : null}
        {view.name === "add" ? (
          <FormView onBack={nav.back} onSaved={(id) => nav.replace({ name: "detail", id })} />
        ) : null}
        {view.name === "edit" ? <FormView id={view.id} onBack={nav.back} onSaved={nav.back} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------------------ */

function ListView({
  query,
  onQueryChange,
  nav,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  nav: Nav;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-6 pt-5 pb-3 sm:pr-14">
        <DialogTitle className="text-xl font-medium tracking-[-0.025em]">Connectors</DialogTitle>
        <DialogDescription className="sr-only">
          Connect MCP servers so the assistant can use their tools in this chat.
        </DialogDescription>
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-60 sm:flex-none">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search"
              aria-label="Search connectors and their tools"
              className="h-9 rounded-full pl-9"
            />
          </div>
          <Button onClick={() => nav.go({ name: "add" })}>
            <PlusIcon />
            Add
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-3 pb-5">
        <CatalogList query={query} nav={nav} />
      </div>
    </>
  );
}

function CatalogList({ query, nav }: { query: string; nav: Nav }) {
  const connectors = useConnectors((s) => s.connectors);
  const status = useConnectors((s) => s.status);
  const q = query.trim().toLowerCase();
  const shown = connectors.filter((c) => matches(c, status[c.id], q));
  const custom = shown.filter((c) => !c.builtin);
  const open = (c: Connector) => nav.go({ name: "detail", id: c.id });

  const sections = CONNECTOR_CATEGORIES.map((cat) => ({
    cat,
    items: shown.filter((c) => c.builtin && findBuiltinConnector(c.id)?.category === cat.id),
  })).filter((s) => s.items.length);

  if (q && !sections.length && !custom.length) return <NoMatches query={query} />;

  return (
    <div className="flex flex-col gap-8">
      {sections.map(({ cat, items }) => {
        // a search shows every match; otherwise each topic previews a couple of rows
        const clipped = !q && items.length > SECTION_PREVIEW;
        return (
          <Section
            key={cat.id}
            title={cat.title}
            blurb={cat.blurb}
            count={items.length}
            onShowAll={clipped ? () => nav.go({ name: "category", id: cat.id }) : undefined}
          >
            {(clipped ? items.slice(0, SECTION_PREVIEW) : items).map((c) => (
              <ConnectorCard key={c.id} connector={c} onOpen={() => open(c)} />
            ))}
          </Section>
        );
      })}
      {custom.length ? (
        <Section title="Custom" blurb="Remote MCP servers you added." count={custom.length}>
          {custom.map((c) => (
            <ConnectorCard key={c.id} connector={c} onOpen={() => open(c)} />
          ))}
        </Section>
      ) : q ? null : (
        <EmptyState onAdd={() => nav.go({ name: "add" })} />
      )}
    </div>
  );
}

function CategoryView({ id, nav }: { id: ConnectorCategory; nav: Nav }) {
  const connectors = useConnectors((s) => s.connectors);
  const cat = CONNECTOR_CATEGORIES.find((c) => c.id === id)!;
  const items = connectors.filter((c) => c.builtin && findBuiltinConnector(c.id)?.category === id);

  return (
    <>
      <div className="flex items-start gap-3 px-6 pt-5 pb-3 pr-14">
        <Button variant="ghost" size="icon-sm" className="-ml-2 shrink-0" aria-label="Back to connectors" onClick={nav.back}>
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0">
          <DialogTitle className="flex items-center gap-2 text-xl font-medium tracking-[-0.025em]">
            {cat.title}
            <CountChip count={items.length} />
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-[13px]">{cat.blurb}</DialogDescription>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-3 pb-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((c) => (
            <ConnectorCard key={c.id} connector={c} onOpen={() => nav.go({ name: "detail", id: c.id })} />
          ))}
        </div>
      </div>
    </>
  );
}

function Section({
  title,
  blurb,
  count,
  onShowAll,
  children,
}: {
  title: string;
  blurb?: string;
  count: number;
  onShowAll?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[15px] font-medium">
            {title}
            <CountChip count={count} />
          </h3>
          {blurb ? <p className="mt-0.5 text-xs text-muted-foreground">{blurb}</p> : null}
        </div>
        {onShowAll ? (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={onShowAll}>
            Show all
            <ArrowRightIcon />
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function CountChip({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground tabular-nums">
      {count}
    </span>
  );
}

function ConnectorCard({ connector, onOpen }: { connector: Connector; onOpen: () => void }) {
  const status = useConnectors((s) => s.status[connector.id]);
  const update = useConnectors((s) => s.update);
  const entry = connector.builtin ? findBuiltinConnector(connector.id) : undefined;

  return (
    <div className="group relative flex gap-3 rounded-xl border bg-card p-3.5 transition-colors hover:bg-muted/40">
      {/* the whole card opens the connector; the action button sits above this layer */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${connector.name}`}
        className="absolute inset-0 z-[1] rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <ConnectorAvatar connector={connector} status={status} size="lg" showStatus={connector.enabled} />
      <div className="min-w-0 flex-1 pr-9">
        <p className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{connector.name}</span>
          {connector.builtin ? (
            <BadgeCheckIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Built in" />
          ) : null}
          <DataTag>{entry ? DATA_LABEL[entry.data] : "Custom"}</DataTag>
        </p>
        <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted-foreground">
          {entry?.description ?? connector.url}
        </p>
        <Byline connector={connector} status={status} showHealth={connector.enabled} />
      </div>
      <Button
        variant="outline"
        size="icon-sm"
        className={cn("absolute top-3 right-3 z-[2] bg-background", connector.enabled && "text-green")}
        onClick={() => update(connector.id, { enabled: !connector.enabled })}
        aria-label={connector.enabled ? `Remove ${connector.name} from chat` : `Add ${connector.name} to chat`}
        title={connector.enabled ? "Added to chat · click to remove" : "Add to chat"}
      >
        {connector.enabled ? <CheckIcon /> : <PlusIcon />}
      </Button>
    </div>
  );
}

function DataTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10.5px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

/** "by Menara · 12 tools", plus connection trouble when `showHealth`. */
function Byline({
  connector,
  status,
  showHealth,
}: {
  connector: Connector;
  status: ConnectorStatus | undefined;
  showHealth: boolean;
}) {
  const publisher = findBuiltinConnector(connector.id)?.publisher ?? hostname(connector.url);
  let health: React.ReactNode = null;
  if (status?.state === "connected") {
    const total = status.inspection.tools.length;
    const off = connector.disabledTools.filter((t) => status.inspection.tools.some((x) => x.name === t)).length;
    health = off ? `${total - off} of ${total} tools` : `${total} ${total === 1 ? "tool" : "tools"}`;
  } else if (showHealth) {
    health =
      status?.state === "error" ? (
        <span className="text-destructive">Couldn&apos;t connect</span>
      ) : (
        "Connecting…"
      );
  }
  return (
    <p className="mt-1.5 truncate text-xs text-muted-foreground">
      by {publisher}
      {health ? <> · {health}</> : null}
    </p>
  );
}

function NoMatches({ query }: { query: string }) {
  return (
    <p className="py-10 text-center text-[13px] text-muted-foreground">
      No connectors or tools match &ldquo;{query.trim()}&rdquo;.
    </p>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed px-3 py-3">
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

/** Search words must all appear in the connector's name, description, topic or its tools. */
function matches(connector: Connector, status: ConnectorStatus | undefined, q: string) {
  if (!q) return true;
  const entry = findBuiltinConnector(connector.id);
  const topic = entry ? CONNECTOR_CATEGORIES.find((c) => c.id === entry.category)?.title : "custom";
  const tools = status?.state === "connected" ? status.inspection.tools : [];
  const haystack = [
    connector.name,
    connector.url,
    entry?.description,
    entry?.publisher,
    topic,
    ...tools.flatMap((t) => [t.name, t.title, t.description]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

function hostname(url: string) {
  try {
    return new URL(url, window.location.origin).hostname;
  } catch {
    return url;
  }
}

/* ------------------------------------------------------------------------------------ */

function DetailView({ id, nav }: { id: string; nav: Nav }) {
  const connector = useConnectors((s) => s.connectors.find((c) => c.id === id));
  const status = useConnectors((s) => s.status[id]);
  const { update, remove, refresh, toggleTool, setAllTools } = useConnectors.getState();
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (!connector) {
    return (
      <div className="flex flex-col items-start gap-3 p-5">
        <DialogTitle className="text-lg font-medium">Connector not found</DialogTitle>
        <Button variant="outline" size="sm" onClick={() => nav.reset({ name: "list" })}>
          <ArrowLeftIcon />
          Back to connectors
        </Button>
      </div>
    );
  }

  const catalogEntry = connector.builtin ? findBuiltinConnector(connector.id) : undefined;
  const category = CONNECTOR_CATEGORIES.find((c) => c.id === catalogEntry?.category);
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
          aria-label="Back"
          onClick={nav.back}
        >
          <ArrowLeftIcon />
        </Button>
        <ConnectorAvatar connector={connector} status={status} size="lg" />
        <div className="min-w-0 flex-1">
          <DialogTitle className="truncate text-lg font-medium">{connector.name}</DialogTitle>
          <DialogDescription className="truncate text-xs">
            {catalogEntry ? `by ${catalogEntry.publisher} · ` : null}
            <span className="font-mono">{connector.url}</span>
          </DialogDescription>
          {catalogEntry ? (
            <p className="mt-1.5 text-[13px] text-muted-foreground">{catalogEntry.description}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {connector.builtin ? <Badge variant="brand">Built-in</Badge> : null}
            <StatusBadge status={status} />
            {catalogEntry ? <Badge variant="outline">{DATA_LABEL[catalogEntry.data]}</Badge> : null}
            {category ? <Badge variant="outline">{category.title}</Badge> : null}
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
          <div className="mx-5 mb-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">
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
            <p className="text-xs font-medium text-muted-foreground">
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
            <ul className="flex flex-col divide-y rounded-xl border">
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
                      <p className="line-clamp-3 text-xs text-muted-foreground" title={tool.description}>
                        {tool.description}
                      </p>
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
                nav.reset({ name: "list" });
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
            <Button variant="outline" size="sm" onClick={() => nav.go({ name: "edit", id })}>
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
          <DialogTitle className="flex items-center gap-2 text-lg font-medium">
            {existing ? "Edit connector" : "Add custom connector"}
            <Badge variant="brand">MCP</Badge>
          </DialogTitle>
          <DialogDescription>Connect a remote MCP server over HTTP. Saved in this browser only.</DialogDescription>
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
  showStatus = true,
}: {
  connector: Connector;
  status: ConnectorStatus | undefined;
  size?: "sm" | "md" | "lg";
  /** Corner dot for connecting / connected / error. */
  showStatus?: boolean;
}) {
  const Icon = CONNECTOR_ICONS[connector.id];
  return (
    <div
      className={cn(
        "relative grid shrink-0 place-items-center font-semibold uppercase",
        size === "sm" && "size-6 rounded-md bg-muted text-[11px] text-muted-foreground",
        size === "md" && "size-9 rounded-lg bg-muted text-sm text-muted-foreground",
        size === "lg" && "size-11 rounded-xl border bg-background text-base text-foreground",
        !connector.enabled && "opacity-50",
      )}
    >
      {Icon ? (
        <Icon className={cn(size === "sm" ? "size-3.5" : size === "md" ? "size-4" : "size-5")} aria-hidden />
      ) : (
        connector.name.slice(0, 1)
      )}
      {showStatus ? (
        <span
          aria-hidden
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-popover",
            !status || status.state === "connecting"
              ? "bg-muted-foreground/40"
              : status.state === "connected"
                ? "bg-green"
                : "bg-destructive",
          )}
        />
      ) : null}
    </div>
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
    <Badge variant="secondary" className="text-green">
      <span className="size-1.5 rounded-full bg-green" />
      Connected
    </Badge>
  );
}

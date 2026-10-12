"""VIP ticketing tools (thd_ticketing + internal-ticketing). Write tools change
the local DuckDB only; send_ticket_email writes to an outbox table and never
sends real email. Set NETOPS_READ_ONLY=1 to disable all write tools."""

import base64
import csv
import datetime as dt
import io
import os
import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from netops_mcp import db
from netops_mcp.errors import AuthError, NotFoundError, ValidationError
from netops_mcp.tools.common import Page, PageSize, csv_list, parse_date

CTT2_RE = re.compile(r"^(\w+)/\d{4}/\d{1,2}/\d{1,6}$")
NAME_RE = re.compile(r"^[A-Za-z\s.@/']+$")
MSISDN_RE = re.compile(r"^\+?[0-9]\d{0,12}$")
ORDERING = ("ctt2", "psc_pic", "week_no", "tt_status", "complaint_forward_by", "case_type", "customer_name",
            "user_details_complaint", "faulty_msisdn", "complaint_datetime")
FILTER_COLUMNS = ("psc_pic", "root_cause2", "problem", "complaint_forward_by", "tt_status", "case_type", "ctt",
                  "site_technology", "cluster", "root_cause1")
LIST_COLUMNS = """id, ctt2, psc_pic, week_no, tt_status, complaint_forward_by, case_type, customer_name,
    user_details_complaint, faulty_msisdn, problem, root_cause2, complaint_datetime, site_id, cluster, region,
    latitude, longitude"""
MAX_ATTACHMENT = 5 * 1024 * 1024


def _writable():
    if os.environ.get("NETOPS_READ_ONLY", "").lower() in ("1", "true", "yes"):
        raise AuthError("Write tools are disabled (NETOPS_READ_ONLY is set)")


def _ticket(ctt2: str) -> dict:
    c = (ctt2 or "").strip()
    if not CTT2_RE.match(c):
        raise ValidationError(f"Invalid ctt2 '{ctt2}'. Expected e.g. VCTT/2026/9/412")
    row = db.query_one("SELECT * FROM THD_Ticket WHERE ctt2 = ?", [c])
    if not row:
        raise NotFoundError("CTT2 is not available")
    return row


def _filters(ctt2, customer_name, msisdn, complaint_date_gte, complaint_date_lte, status, psc_pic, root_cause2,
             problem, complaint_forward_by):
    where, params = [], []
    for col, val in (("ctt2", ctt2), ("customer_name", customer_name), ("faulty_msisdn", msisdn)):
        if val:
            where.append(f"{col} ILIKE ?")
            params.append(f"%{val.strip()}%")
    gte, lte = parse_date(complaint_date_gte, "complaint_date_gte"), parse_date(complaint_date_lte, "complaint_date_lte")
    if gte:
        where.append("complaint_datetime >= ?")
        params.append(dt.datetime.combine(gte, dt.time()))
    if lte:
        where.append("complaint_datetime <= ?")
        params.append(dt.datetime.combine(lte, dt.time(23, 59, 59)))
    for col, val in (("tt_status", status), ("psc_pic", psc_pic), ("root_cause2", root_cause2), ("problem", problem),
                     ("complaint_forward_by", complaint_forward_by)):
        vals = csv_list(val)
        if vals:
            where.append(f"{col} IN ({','.join('?' * len(vals))})")
            params += vals
    return (" WHERE " + " AND ".join(where)) if where else "", params


def _ordering(ordering: str | None) -> str:
    if not ordering:
        return "complaint_datetime DESC"
    parts = []
    for o in csv_list(ordering):
        desc = o.startswith("-")
        f = o.lstrip("-")
        if f not in ORDERING:
            raise ValidationError(f"'ordering' field must be one of: {', '.join(ORDERING)}")
        parts.append(f"{f} {'DESC' if desc else 'ASC'}")
    return ", ".join(parts)


Status = Annotated[str | None, Field(description="tt_status: Open, In Progress, Closed, Completed PSC (comma list ok)")]


def get_vip_tickets(
    ctt2: str | None = None,
    customer_name: str | None = None,
    msisdn: str | None = None,
    complaint_date_gte: Annotated[str | None, Field(description="YYYY-MM-DD")] = None,
    complaint_date_lte: Annotated[str | None, Field(description="YYYY-MM-DD")] = None,
    status: Status = None,
    psc_pic: str | None = None,
    root_cause2: str | None = None,
    problem: str | None = None,
    complaint_forward_by: str | None = None,
    ordering: Annotated[str | None, Field(description="Field name, '-' prefix for descending, e.g. '-complaint_datetime'")] = None,
    page: Page = 1,
    page_size: PageSize = 20,
) -> dict:
    """List VIP tickets with filters: ctt2 / customer_name / msisdn (partial), complaint date range, status, PSC PIC,
    root cause, problem and forwarded-by (exact or comma list). Each row has ctt2, status, customer, complaint, site,
    cluster, region and coordinates. Default order newest complaint first. Paginated; returns total."""
    where, params = _filters(ctt2, customer_name, msisdn, complaint_date_gte, complaint_date_lte, status, psc_pic,
                             root_cause2, problem, complaint_forward_by)
    return db.paginate(f"SELECT {LIST_COLUMNS} FROM THD_Ticket{where}", params, page, page_size,
                       order_by=_ordering(ordering))


def get_vip_ticket_detail(ctt2: Annotated[str, Field(description="Ticket ID, e.g. VCTT/2026/9/412")]) -> dict:
    """Get every field of one VIP ticket (complaint, location, timings and KPIs, findings, per-team feedback, root
    causes) plus its escalated groups and attachment count."""
    t = _ticket(ctt2)
    t["escalated_groups"] = db.query("""SELECT g.id, g.name FROM THD_Ticket_escalated_groups e
        JOIN auth_group g ON g.id = e.usergroup_id WHERE e.thdticket_id = ? ORDER BY g.id""", [t["id"]])
    t["attachment_count"] = db.scalar("SELECT COUNT(*) FROM THD_Ticket_Attachment WHERE ticket_id = ?", [t["id"]])
    return t


def get_ticket_filter_options() -> dict:
    """Get the dropdown values for VIP ticket filters and search: distinct PSC PIC, root causes, problem, forwarded-by,
    status, case type, CTT prefix, site technology and cluster."""
    return {col: [r["v"] for r in db.query(
        f"SELECT DISTINCT {col} AS v FROM THD_Ticket WHERE {col} IS NOT NULL AND trim({col}) <> '' ORDER BY v")]
            for col in FILTER_COLUMNS}


def export_vip_tickets_csv(
    ctt2: str | None = None,
    customer_name: str | None = None,
    msisdn: str | None = None,
    complaint_date_gte: str | None = None,
    complaint_date_lte: str | None = None,
    status: Status = None,
    psc_pic: str | None = None,
    root_cause2: str | None = None,
    problem: str | None = None,
    complaint_forward_by: str | None = None,
    ordering: str | None = None,
) -> dict:
    """Export VIP tickets as CSV text (all ticket columns) using the same filters as get_vip_tickets. Returns
    filename, row_count and the csv content; capped at 5000 rows."""
    where, params = _filters(ctt2, customer_name, msisdn, complaint_date_gte, complaint_date_lte, status, psc_pic,
                             root_cause2, problem, complaint_forward_by)
    rows = db.query(f"SELECT * FROM THD_Ticket{where} ORDER BY {_ordering(ordering)} LIMIT 5001", params)
    truncated = len(rows) > 5000
    rows = rows[:5000]
    buf = io.StringIO()
    if rows:
        w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        w.writeheader()
        for r in rows:
            w.writerow({k: "" if v is None else v for k, v in r.items()})
    return {"filename": f"THD_VIP_Ticket_{db.ref_date().isoformat()}.csv", "row_count": len(rows),
            "truncated": truncated, "csv": buf.getvalue()}


def get_ticket_comments(
    type: Literal["remark", "feedback"],
    scope: Literal["latest_per_group", "history"],
    ctt2: str,
    group_id: int | None = None,
    page: Page = 1,
    page_size: PageSize = 50,
) -> dict:
    """Get remarks or feedback on a VIP ticket. scope=latest_per_group returns the newest entry per escalated group;
    scope=history returns every entry, newest first. Optional group_id filter. Each row has group, PIC name, text,
    status, turn, open/close dates and timestamps. Paginated; returns total."""
    t = _ticket(ctt2)
    kind = type.lower()
    if kind not in ("remark", "feedback"):
        raise ValidationError("'type' must be remark or feedback")
    cols = ("f.feedback" if kind == "feedback" else
            "f.remark, f.feedback, f.turn, f.status, f.open_date, f.close_date")
    where, params = "f.ticket_id = ?", [t["id"]]
    if group_id is not None:
        where += " AND f.group_id = ?"
        params.append(group_id)
    base = f"""SELECT f.id, f.group_id, g.name AS "group", f.name, {cols}, f.created_at, f.updated_at,
                      row_number() OVER (PARTITION BY f.group_id ORDER BY f.updated_at DESC, f.id DESC) AS rn
               FROM THD_Ticket_Feedback f LEFT JOIN auth_group g ON g.id = f.group_id WHERE {where}"""
    if scope.lower() == "latest_per_group":
        sql, order = f"SELECT * EXCLUDE (rn) FROM ({base}) WHERE rn = 1", "group_id"
    elif scope.lower() == "history":
        sql, order = f"SELECT * EXCLUDE (rn) FROM ({base})", "updated_at DESC, id DESC"
    else:
        raise ValidationError("'scope' must be latest_per_group or history")
    return {"ctt2": t["ctt2"], "type": kind, **db.paginate(sql, params, page, page_size, order_by=order)}


def get_ticket_assignees(
    type: Literal["group", "pic"],
    name_filter: Annotated[str | None, Field(description="Partial name match")] = None,
) -> dict:
    """Get ticket assignees: type=group returns escalation groups (id, name); type=pic returns distinct PIC names that
    have commented on tickets. Optional partial name_filter."""
    kind = type.lower()
    if name_filter and not NAME_RE.match(name_filter):
        raise ValidationError("'name_filter' may contain letters, spaces and . @ / only")
    like = f"%{name_filter or ''}%"
    if kind == "group":
        return {"type": kind, "items": db.query(
            "SELECT g.id, g.name FROM Groups gr JOIN auth_group g ON g.id = gr.group_ptr_id WHERE g.name ILIKE ? "
            "ORDER BY g.id", [like])}
    if kind == "pic":
        return {"type": kind, "items": [r["name"] for r in db.query(
            "SELECT DISTINCT name FROM THD_Ticket_Feedback WHERE name ILIKE ? ORDER BY name", [like])]}
    raise ValidationError("'type' must be group or pic")


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------
class VipTicketCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ctt: Literal["VCTT", "ECTT"] = Field(description="Ticket prefix")
    complaint_datetime: dt.datetime = Field(description="ISO datetime of the complaint")
    psc_pic: str
    tt_status: Literal["Open", "In Progress", "Closed", "Completed PSC"] = "Open"
    complaint_forward_by: str = Field(description="Careline or VIP Group")
    customer_name: str
    case_type: str = Field(description="Coverage or Enquiry")
    user_details_complaint: str
    faulty_msisdn: str
    escalated_groups: list[int] = Field(default_factory=list, description="Group IDs from get_ticket_assignees")
    update_l1: str | None = None
    phone_brand: str | None = None
    phone_model: str | None = None
    problem: str | None = None
    faulty_location_address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    escalation_datetime: dt.datetime | None = None
    resolved_datetime: dt.datetime | None = None
    site_id: str | None = None
    serving_cells: str | None = None
    cluster: str | None = None
    region: str | None = None
    state: str | None = None
    finding: str | None = None
    root_cause1: str | None = None
    root_cause2: str | None = None
    site_technology: str | None = None
    morphology: str | None = None
    notes: str | None = None


def create_vip_ticket(payload: VipTicketCreate) -> dict:
    """Create a VIP ticket. Required: ctt (VCTT/ECTT), complaint_datetime, psc_pic, complaint_forward_by,
    customer_name, case_type, user_details_complaint, faulty_msisdn. The server assigns ctt2
    ('{ctt}/{year}/{month}/{running}'), week, escalation/resolve hours and KPI labels, and links escalated_groups.
    Returns the new ctt2."""
    _writable()
    p = payload
    for name in ("psc_pic", "customer_name"):
        if not NAME_RE.match(getattr(p, name)):
            raise ValidationError(f"'{name}' may contain letters, spaces and . @ / only")
    if not MSISDN_RE.match(p.faulty_msisdn):
        raise ValidationError("'faulty_msisdn' must be digits, optional leading +")
    c = p.complaint_datetime.replace(second=0, microsecond=0, tzinfo=None)
    esc = p.escalation_datetime.replace(tzinfo=None) if p.escalation_datetime else None
    res = p.resolved_datetime.replace(tzinfo=None) if p.resolved_datetime else None
    if esc and esc < c:
        raise ValidationError("escalation_datetime must be after complaint_datetime")
    if res and (res <= c or (esc and res <= esc)):
        raise ValidationError("resolved_datetime must be after complaint and escalation")
    known = {r["id"] for r in db.query("SELECT id FROM auth_group")}
    bad = [g for g in p.escalated_groups if g not in known]
    if bad:
        raise ValidationError(f"Unknown group id(s): {bad}")
    running = int(db.scalar("SELECT COALESCE(MAX(running_number), 0) + 1 FROM THD_Ticket"))
    ctt2 = f"{p.ctt}/{c.year}/{c.month}/{running}"
    esc_h = round((esc - c).total_seconds() / 3600, 2) if esc else None
    res_h = round((res - c).total_seconds() / 3600, 2) if res else None
    tid = db.next_id("THD_Ticket")
    fields = p.model_dump(exclude={"escalated_groups", "complaint_datetime", "escalation_datetime", "resolved_datetime"})
    fields.update(id=tid, ctt2=ctt2, complaint_datetime=c, escalation_datetime=esc, resolved_datetime=res,
                  escalation_hour=esc_h, resolved_hour=res_h, week_no=c.isocalendar()[1], month=c.month, year=c.year,
                  running_number=running,
                  escalation_hour_kpi=None if esc_h is None else "Within 1 hour" if esc_h <= 1 else "More than 1 hour",
                  resolve_hour_kpi=None if res_h is None else "Within 8 hour" if res_h <= 8 else "More than 8 hour")
    cols = list(fields)
    db.execute(f"INSERT INTO THD_Ticket ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
               [fields[k] for k in cols])
    for g in dict.fromkeys(p.escalated_groups):
        db.execute("INSERT INTO THD_Ticket_escalated_groups VALUES (?, ?, ?)",
                   [db.next_id("THD_Ticket_escalated_groups"), tid, g])
    return {"status": True, "message": f"The ticket {ctt2} has been successfully created.", "ctt2": ctt2}


def delete_vip_ticket(ctt2: Annotated[str, Field(description="Ticket ID, or comma-separated list of IDs")]) -> dict:
    """Delete one or more VIP tickets by ctt2, together with their feedback/remarks, escalated groups, attachments and
    email log. Returns the deleted ctt2 values and count. This cannot be undone."""
    _writable()
    ids = csv_list(ctt2)
    if not ids:
        raise ValidationError("'ctt2' is required")
    rows = db.query(f"SELECT id, ctt2 FROM THD_Ticket WHERE ctt2 IN ({','.join('?' * len(ids))})", ids)
    if not rows:
        return {"status": True, "message": "Tickets not found", "count": 0, "deleted": []}
    tids = [r["id"] for r in rows]
    ph = ",".join("?" * len(tids))
    for table, col in (("THD_Ticket_Feedback", "ticket_id"), ("THD_Ticket_escalated_groups", "thdticket_id"),
                       ("THD_Ticket_Attachment", "ticket_id"), ("THD_Ticket_Email_Log", "ticket_id"),
                       ("THD_Ticket", "id")):
        db.execute(f"DELETE FROM {table} WHERE {col} IN ({ph})", tids)
    return {"status": True, "message": "Tickets successfully removed", "count": len(rows),
            "deleted": [r["ctt2"] for r in rows]}


class CommentPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(description="PIC name")
    text: str = Field(description="The remark or feedback text")
    status: Literal["Open", "Closed"] = "Open"
    turn: str | None = Field(default=None, description="Turn number; defaults to the next turn for the group")
    open_date: dt.datetime | None = None
    close_date: dt.datetime | None = None


def add_ticket_comment(type: Literal["remark", "feedback"], ctt2: str, group_id: int, payload: CommentPayload) -> dict:
    """Add a remark or feedback entry to a VIP ticket for an escalation group (name, text, status Open/Closed,
    optional turn and open/close dates). Returns the new comment id."""
    _writable()
    kind = type.lower()
    if kind not in ("remark", "feedback"):
        raise ValidationError("'type' must be remark or feedback")
    t = _ticket(ctt2)
    if not db.scalar("SELECT COUNT(*) FROM auth_group WHERE id = ?", [group_id]):
        raise ValidationError(f"Unknown group_id {group_id}")
    if not NAME_RE.match(payload.name):
        raise ValidationError("'name' may contain letters, spaces and . @ / only")
    turn = payload.turn or str(int(db.scalar(
        "SELECT COUNT(*) FROM THD_Ticket_Feedback WHERE ticket_id = ? AND group_id = ?", [t["id"], group_id])) + 1)
    now = dt.datetime.now().replace(microsecond=0)
    cid = db.next_id("THD_Ticket_Feedback")
    db.execute("INSERT INTO THD_Ticket_Feedback VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
               [cid, t["id"], group_id, payload.name, payload.text if kind == "feedback" else None,
                payload.text if kind == "remark" else None, payload.status, turn, payload.open_date or now,
                payload.close_date, now, now])
    return {"status": True, "id": cid, "message": f"The ticket {kind} has been successfully logged."}


class EmailPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    group_ids: list[int] = Field(default_factory=list, description="Recipient groups (escalation adds them to the ticket)")
    remark: str | None = None


def send_ticket_email(type: Literal["new_ticket", "escalation"], ctt2: str, payload: EmailPayload) -> dict:
    """Queue a ticket email of type new_ticket or escalation to the given groups' mailboxes. Escalation also links the
    groups to the ticket. This synthetic server only records the email in an outbox table (THD_Ticket_Email_Log)
    and never delivers it. Returns recipients and subject."""
    _writable()
    kind = type.lower()
    if kind not in ("new_ticket", "escalation"):
        raise ValidationError("'type' must be new_ticket or escalation")
    t = _ticket(ctt2)
    if not payload.group_ids:
        raise ValidationError("'group_ids' needs at least one group")
    groups = db.query(f"""SELECT g.id, g.name, gr.email FROM auth_group g JOIN Groups gr ON gr.group_ptr_id = g.id
                          WHERE g.id IN ({','.join('?' * len(payload.group_ids))})""", payload.group_ids)
    missing = set(payload.group_ids) - {g["id"] for g in groups}
    if missing:
        raise ValidationError(f"Unknown group id(s): {sorted(missing)}")
    if kind == "escalation":
        linked = {r["usergroup_id"] for r in db.query(
            "SELECT usergroup_id FROM THD_Ticket_escalated_groups WHERE thdticket_id = ?", [t["id"]])}
        for g in groups:
            if g["id"] not in linked:
                db.execute("INSERT INTO THD_Ticket_escalated_groups VALUES (?, ?, ?)",
                           [db.next_id("THD_Ticket_escalated_groups"), t["id"], g["id"]])
    verb = "escalated to your team" if kind == "escalation" else "created"
    subject = f"[NOC] - {t['ctt2']}" if kind == "escalation" else f"[NOC] New VIP ticket {t['ctt2']}"
    content = (f"<p>Ticket {t['ctt2']} ({t['customer_name']}, {t['problem'] or 'complaint'}) has been {verb}.</p>"
               + (f"<p>Remark: {payload.remark}</p>" if payload.remark else ""))
    recipients = [g["email"] for g in groups]
    db.execute("INSERT INTO THD_Ticket_Email_Log VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
               [db.next_id("THD_Ticket_Email_Log"), t["id"], kind, "noc@example.com", ",".join(recipients), subject,
                content, dt.datetime.now().replace(microsecond=0)])
    return {"status": True, "message": "Email queued in outbox (synthetic server: not delivered)",
            "recipients": recipients, "subject": subject}


def get_ticket_attachments(ctt2: str, page: Page = 1, page_size: PageSize = 50) -> dict:
    """List attachments of a VIP ticket (filename, content type, size in bytes, uploader, upload time) without their
    content. Use download_ticket_attachment to fetch a file. Paginated; returns total."""
    t = _ticket(ctt2)
    return {"ctt2": t["ctt2"], **db.paginate(
        "SELECT id, filename, content_type, size_bytes, uploaded_by, uploaded_at FROM THD_Ticket_Attachment "
        "WHERE ticket_id = ?", [t["id"]], page, page_size, order_by="uploaded_at DESC, id DESC")}


class AttachmentFile(BaseModel):
    filename: str
    content_base64: str = Field(description="File content, base64-encoded")
    content_type: str | None = None


def upload_ticket_attachment(ctt2: str, files: list[AttachmentFile],
                             uploaded_by: str = "NetOps MCP") -> dict:
    """Upload one or more attachments to a VIP ticket (filename + base64 content, max 5 MB each). A file with the same
    name replaces the previous one. Returns the stored filenames and sizes."""
    _writable()
    t = _ticket(ctt2)
    if not files:
        raise ValidationError("'files' needs at least one file")
    out = []
    for f in files:
        name = re.sub(r"[\\/:*?\"<>|]+", "_", f.filename).strip()
        if not name:
            raise ValidationError("Each file needs a filename")
        try:
            data = base64.b64decode(f.content_base64, validate=True)
        except ValueError:
            raise ValidationError(f"'{name}' content is not valid base64")
        if len(data) > MAX_ATTACHMENT:
            raise ValidationError(f"'{name}' exceeds 5 MB")
        db.execute("DELETE FROM THD_Ticket_Attachment WHERE ticket_id = ? AND filename = ?", [t["id"], name])
        db.execute("INSERT INTO THD_Ticket_Attachment VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                   [db.next_id("THD_Ticket_Attachment"), t["id"], name, f.content_type or _guess(name), len(data),
                    data, uploaded_by, dt.datetime.now().replace(microsecond=0)])
        out.append({"filename": name, "size_bytes": len(data)})
    return {"status": True, "ctt2": t["ctt2"], "uploaded": out}


def _guess(name: str) -> str:
    import mimetypes
    return mimetypes.guess_type(name)[0] or "application/octet-stream"


def download_ticket_attachment(ctt2: str, filename: str) -> dict:
    """Download a VIP ticket attachment by filename. Returns filename, content type, size in bytes and the content
    base64-encoded (plus decoded text for text files)."""
    t = _ticket(ctt2)
    rows = db.raw("SELECT filename, content_type, size_bytes, content FROM THD_Ticket_Attachment "
                  "WHERE ticket_id = ? AND filename = ?", [t["id"], filename])
    if not rows:
        raise NotFoundError(f"Attachment '{filename}' not found on {t['ctt2']}")
    name, ctype, size, content = rows[0]
    content = bytes(content)
    out = {"filename": name, "content_type": ctype, "size_bytes": size,
           "content_base64": base64.b64encode(content).decode()}
    if ctype and ctype.startswith("text/"):
        out["text"] = content.decode("utf-8", errors="replace")
    return out


TOOLS = [
    get_vip_tickets, get_vip_ticket_detail, get_ticket_filter_options, export_vip_tickets_csv, get_ticket_comments,
    get_ticket_assignees, create_vip_ticket, delete_vip_ticket, add_ticket_comment, send_ticket_email,
    get_ticket_attachments, upload_ticket_attachment, download_ticket_attachment,
]

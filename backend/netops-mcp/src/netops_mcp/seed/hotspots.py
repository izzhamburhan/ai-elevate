"""Demo hotspots: extra NTT (4G + 5G), CTT, VIP tickets and planned maintenance
concentrated on Cyberjaya and Kuala Lumpur, with the rest of Selangor (and
Putrajaya next door to Cyberjaya) as a lighter backdrop.

Besides background history it scripts a few live stories the demo can lean on:
a fibre cut isolating three Cyberjaya eNodeBs, open outages around KLCC and
Bukit Bintang, a complaint (CTT) spike that follows them, maintenance running
right now, and a calendar of upcoming windows (Cyberjaya 5G readiness swap,
Bukit Bintang capacity upgrade, IMS/MME core patches).

Uses its own RNG, so the nationwide data from the other steps is unchanged.
CTT and VIP rows are handed to build_dashboards / build_vip_tickets via ctx so
they share ids, case numbers and monthly totals with the rest."""

import datetime as dt
import random

from netops_mcp import config, geo
from netops_mcp.seed import network as N
from netops_mcp.seed import reference as R
from netops_mcp.seed.util import bulk_insert, iso, weighted

CYBERJAYA = ["CL_SL_06"]
KL = ["CL_KL_01", "CL_KL_02", "CL_KL_03", "CL_KL_04", "CL_KL_05"]
SELANGOR = ["CL_SL_01", "CL_SL_02", "CL_SL_03", "CL_SL_04", "CL_SL_05", "CL_SL_07", "CL_SL_08", "CL_PJ_01"]
# background-history weights; Cyberjaya has only ~9 sites, so a smaller share is still dense per site
AREAS = [(CYBERJAYA, 0.2), (KL, 0.5), (SELANGOR, 0.3)]

# Klang Valley core hosts (no Site4G row, like R.CORE_HOSTS)
CORE_HOSTS = ["CBJ-IMS-02", "CBJ-PGW-01", "CBJ-DC-CORESW-01", "KVL-MME-01", "KUL-SGW-02", "KUL-FW-01"]

FIBRE_CUT = ("Fibre cut along Persiaran Multimedia, Cyberjaya (third-party road works). Transmission ring down, "
             "eNodeBs isolated from OSS. Splicing team dispatched.")
# Live open 4G NTTs: (cluster, fault, symptom, hours ago, problem, major)
LIVE_NTT = [
    ("CL_SL_06", "Partial Outage", "LTE - Power Issue", 9,
     "TNB supply trip at site, running on battery backup. Genset en route.", "N"),
    ("CL_KL_01", "Total Outage", "LTE - 4G Service Down", 6,
     "BBU fault after power surge, all LTE cells down. Spare BBU dispatched from KL store.", "Y"),
    ("CL_KL_01", "Partial Outage", "LTE - Packet Loss", 14,
     "High packet loss on metro-E backhaul, user throughput degraded on all sectors.", "N"),
    ("CL_KL_02", "Total Outage", "LTE - eNodeB Isolate", 4,
     "eNodeB isolated, microwave link to hub site down after heavy rain.", "Y"),
    ("CL_KL_02", "Partial Outage", "LTE - Others", 20,
     "VSWR alarm on sector 2 RRU, sector cells disabled.", "N"),
    ("CL_KL_04", "Total Outage", "LTE - Power Issue", 11,
     "Battery bank depleted after prolonged TNB outage, site down.", "N"),
    ("CL_KL_05", "Partial Outage", "LTE - Others", 26,
     "Intermittent RRU alarms on TDD2300 layer, cells flapping.", "N"),
    ("CL_KL_03", "Partial Outage", "LTE - Packet Loss", 31,
     "Packet loss on fibre backhaul, OLT port errors under investigation.", "N"),
    ("CL_SL_01", "Total Outage", "LTE - 4G Service Down", 7, None, "N"),
    ("CL_SL_02", "Partial Outage", "LTE - Power Issue", 16, None, "N"),
    ("CL_SL_05", "Total Outage", "LTE - eNodeB Isolate", 3, None, "N"),
    ("CL_PJ_01", "Partial Outage", "LTE - Others", 22, None, "N"),
]


def build_hotspots(ctx):
    rng = random.Random(f"{config.SEED}-hotspots")
    sites = {cid: [s for s in ctx.sites4g if s["cluster"]["id"] == cid] for cid in CYBERJAYA + KL + SELANGOR}
    sites5g = [s for s in ctx.sites5g if s["cluster"]["id"] in KL + SELANGOR]

    def pick_site():
        return rng.choice(sites[rng.choice(weighted(rng, AREAS))])

    live = _ntt_4g(ctx, rng, sites, pick_site)
    _ntt_5g(ctx, rng, sites5g)
    _plan_maintenance(ctx, rng, sites, pick_site, busy={s["id"] for s in live})
    _ctt(ctx, rng, sites, pick_site, live)


# ---------------------------------------------------------------------------
# NTT
# ---------------------------------------------------------------------------
def _ntt_4g(ctx, rng, sites, pick_site):
    ref_dt = ctx.ref_dt
    events, outage_days, live = [], set(), []

    def ticket(site, created, fault, final, *args, **kw):
        N.ntt_ticket(ctx, rng, events, outage_days, site, created, fault, final, *args, **kw)

    # background history, same open/closed mix as the nationwide tickets
    for _ in range(260):
        site = pick_site()
        created = ref_dt - dt.timedelta(days=rng.uniform(0, 120), hours=rng.uniform(0, 12))
        age = (ref_dt - created).days
        p_open = 0.6 if age < 2 else 0.2 if age < 7 else 0.03
        final = "Open" if rng.random() < p_open else rng.choice(R.NTT_CLOSED_STATUSES)
        ticket(site, created, weighted(rng, R.NTT_FAULTS), final)

    # Cyberjaya fibre cut: three neighbouring eNodeBs isolated together
    cbj = sites["CL_SL_06"]
    first = rng.choice(cbj)
    cut = sorted(cbj, key=lambda s: geo.haversine_km(first["lat"], first["lng"], s["lat"], s["lng"]))[:3]
    created = ref_dt - dt.timedelta(hours=3, minutes=40)
    for k, site in enumerate(cut):
        ticket(site, created + dt.timedelta(minutes=2 * k), "Total Outage", "Open", "LTE - eNodeB Isolate",
               problem=FIBRE_CUT, major="Y", resp="LTE 4G")
        live.append(site)

    for cid, fault, symptom, hours, problem, major in LIVE_NTT:
        taken = {s["id"] for s in live}
        site = rng.choice([s for s in sites[cid] if s["id"] not in taken])
        ticket(site, ref_dt - dt.timedelta(hours=hours, minutes=rng.randint(0, 59)), fault, "Open", symptom,
               problem=problem, major=major, resp="LTE 4G")
        live.append(site)

    # recently restored, so the outage history around the hotspots is not all open
    for cid in ("CL_SL_06", "CL_KL_01", "CL_KL_02"):
        for _ in range(3):
            site = rng.choice(sites[cid])
            ticket(site, ref_dt - dt.timedelta(days=rng.uniform(1, 6)), rng.choice(["Total Outage", "Partial Outage"]),
                   "Network Resolved", resp="LTE 4G")

    ctx.open_outage_sites.update(s["id"] for s in live)

    first_id = ctx.con.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM ntt_granite").fetchone()[0]
    bulk_insert(ctx.con, "ntt_granite", N.NTT_COLUMNS, N.ntt_rows(rng, events, first_id))
    known = set(ctx.con.execute("SELECT site_id, dt FROM _outage_days").fetchall())
    bulk_insert(ctx.con, "_outage_days", ["site_id", "dt"], sorted(outage_days - known))
    return live


def _ntt_5g(ctx, rng, sites5g):
    ref_dt = ctx.ref_dt
    kl5g = [s for s in sites5g if s["cluster"]["id"] in KL]
    inc_events = []
    k = 1000  # keeps DNB / TM incident numbers clear of the nationwide ones
    for _ in range(80):
        site = rng.choice(kl5g if rng.random() < 0.65 else sites5g)
        created = ref_dt - dt.timedelta(days=rng.uniform(0, 120), hours=rng.uniform(0, 12))
        age = (ref_dt - created).days
        p_open = 0.6 if age < 3 else 0.15 if age < 10 else 0.02
        final = rng.choice(R.NTT5G_OPEN) if rng.random() < p_open else weighted(
            rng, [("Resolved", 0.45), ("Closed", 0.45), ("Cancelled", 0.1)])
        N.ntt5g_incident(rng, ref_dt, inc_events, site, k, created, final)
        k += 1
    # live critical incidents in KL (the site shows Out of Service) and a pending one elsewhere in Selangor
    for site, final, prio in [(s, st, "Critical") for s, st in zip(rng.sample(kl5g, 3), ["Assigned", "In Progress", "In Progress"])] + \
                             [(rng.choice([s for s in sites5g if s not in kl5g]), "Pending", "High")]:
        N.ntt5g_incident(rng, ref_dt, inc_events, site, k, ref_dt - dt.timedelta(hours=rng.uniform(2, 20)), final, prio)
        k += 1
    first_id = ctx.con.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM ntt_5g_ntt5g").fetchone()[0]
    bulk_insert(ctx.con, "ntt_5g_ntt5g", N.NTT5G_COLUMNS, N.ntt5g_rows(rng, inc_events, first_id))


# ---------------------------------------------------------------------------
# Planned maintenance
# ---------------------------------------------------------------------------
def _plan_maintenance(ctx, rng, sites, pick_site, busy):
    ref_dt = ctx.ref_dt
    seq0 = ctx.con.execute("SELECT COUNT(*) FROM Webe_Plan_Maintenance").fetchone()[0]
    rows = []

    def rfc(host, created, start, end, status, nca="CA", subnet=None, title=None, reason=None):
        rows.append(N.rfc_row(rng, seq0 + len(rows) + 1, host, "CENTRAL", created, start, end, status, nca, subnet,
                              title, reason))

    def night(days_ahead, hour=1, hours=4):
        start = (ref_dt + dt.timedelta(days=days_ahead)).replace(hour=hour, minute=0, second=0)
        return start, start + dt.timedelta(hours=hours)

    def free(cid, n):
        pool = [s for s in sites[cid] if s["id"] not in busy]
        chosen = rng.sample(pool, min(n, len(pool)))
        busy.update(s["id"] for s in chosen)
        return chosen

    # background history, same timing / status rules as the nationwide RFCs
    for _ in range(200):
        created = ref_dt - dt.timedelta(days=rng.uniform(0, 120))
        start, end, status = N.rfc_window(rng, ref_dt, created)
        nca = "CA" if rng.random() < 0.7 else "NCA"
        if rng.random() < 0.85:
            rfc(pick_site()["id"], created, start, end, status, nca)
        else:
            rfc(rng.choice(CORE_HOSTS), created, start, end, status, nca, rng.choice(R.PM_CORE_SUBNET))

    # running right now (WIMPLEMENTER + CA, window covering the reference date)
    active = [("CL_SL_06", 2), ("CL_KL_01", 1), ("CL_KL_02", 1), ("CL_KL_03", 1), ("CL_KL_04", 1),
              ("CL_SL_01", 1), ("CL_SL_03", 1)]
    for cid, n in active:
        for site in free(cid, n):
            created = ref_dt - dt.timedelta(days=rng.uniform(3, 10))
            start = ref_dt - dt.timedelta(hours=rng.uniform(1, 8))
            rfc(site["id"], created, start, ref_dt + dt.timedelta(hours=rng.uniform(3, 20)), "WIMPLEMENTER", "CA",
                rng.choice(["RAN-Antenna and RRU", "TX-Microwave link", "RAN-Power cabinet and PDU - Base Station"]))
            ctx.active_pm_sites.add(site["id"])

    # upcoming calendar
    sat = (5 - ctx.ref.weekday()) % 7 or 7
    start, end = night(sat, 1, 4)
    for site in free("CL_SL_06", 4):
        rfc(site["id"], ref_dt - dt.timedelta(days=rng.uniform(1, 3)), start, end, "WCAB", "CA",
            "RAN-ENodeB hardware - EnodeB", "Cyberjaya 5G readiness: BBU swap and TDD2600 carrier add", "Project")
    for k, site in enumerate(free("CL_KL_02", 3)):
        s, e = night(5 + k, 0, 5)
        rfc(site["id"], ref_dt - dt.timedelta(days=rng.uniform(1, 4)), s, e, "WIMPLEMENTER", "CA",
            "RAN-ENodeB hardware - EnodeB", "Bukit Bintang capacity upgrade: TDD2600 carrier add", "Project")
    start, end = night(9, 2, 3)
    for site in free("CL_KL_01", 2):
        rfc(site["id"], ref_dt - dt.timedelta(days=rng.uniform(0.5, 2)), start, end, "WCC", "CA",
            "RAN-Antenna and RRU", "Antenna re-tilt for KLCC Park outdoor coverage", "Customer Request")
    for cid in ("CL_KL_04", "CL_KL_05", "CL_SL_02", "CL_SL_05", "CL_SL_07", "CL_PJ_01"):
        for site in free(cid, 2):
            s, e = night(rng.randint(1, 21), rng.choice([0, 1, 2, 23]), rng.randint(2, 6))
            rfc(site["id"], ref_dt - dt.timedelta(days=rng.uniform(0.5, 6)), s, e,
                weighted(rng, [("WIMPLEMENTER", 0.5), ("WCAB", 0.4), ("WCC", 0.1)]),
                "CA" if rng.random() < 0.7 else "NCA")
    s, e = night((1 - ctx.ref.weekday()) % 7 or 7, 0, 4)  # next Tuesday
    rfc("CBJ-IMS-02", ref_dt - dt.timedelta(days=2), s, e, "WIMPLEMENTER", "CA", "VOICE-IMS",
        "IMS software patch (VoLTE call setup fix), Cyberjaya DC", "Problem Management")
    s, e = night(12, 1, 4)
    rfc("KVL-MME-01", ref_dt - dt.timedelta(days=1), s, e, "WCAB", "CA", "PS CORE-PGW",
        "Klang Valley MME software upgrade", "Maintenance")
    bulk_insert(ctx.con, "Webe_Plan_Maintenance", N.PM_COLUMNS, rows)


# ---------------------------------------------------------------------------
# CTT (THD) and VIP tickets
# ---------------------------------------------------------------------------
def _ctt(ctx, rng, sites, pick_site, live):
    ref, ref_dt = ctx.ref, ctx.ref_dt
    start = dt.datetime(ref.year - 1, 1, 1)
    span = (ref_dt - start).total_seconds()
    rows = []

    def case(site, created, case_type, root=None, km=1.5, status=None):
        lat, lng = geo.offset(site["lat"], site["lng"], rng.uniform(0, 360), rng.uniform(0.05, km))
        n = 5001 + len(rows)  # case numbers clear of the nationwide ones
        rows.append((n, created, iso(created.date())[1], created.month, str(created.year), site["region"],
                     site["cluster"]["name"], site["id"], site["state"][:15], f"CAS-{created:%y%m}{n:06d}", case_type,
                     "VIP" if rng.random() < 0.05 else "Mass",
                     status or ("Closed" if created.date() < ref - dt.timedelta(days=10) or rng.random() < 0.4 else "Open"),
                     root or rng.choice(R.CTT_ROOT_CAUSES),
                     "Network Root Cause" if root else rng.choice(["Network Root Cause", "Other Root Cause"]),
                     rng.choice(["4G", "4G", "4G", "5G"]), round(lat, 6), round(lng, 6)))

    # background, skewed towards recent months
    for _ in range(1000):
        case(pick_site(), start + dt.timedelta(seconds=span * rng.random() ** 0.8), weighted(rng, R.CTT_CASE_TYPES))

    # spike following the live outages: complaints start shortly after each outage
    outage_start = dict(ctx.con.execute("""SELECT split_part(network_element_ne_id, ',', 1), max(created_date)
        FROM ntt_granite WHERE id IN (SELECT max(id) FROM ntt_granite GROUP BY ntt_no) AND status = 'Open'
        GROUP BY 1""").fetchall())
    for site in live:
        t0 = outage_start.get(site["id"], ref_dt - dt.timedelta(hours=6))
        hours = max((ref_dt - t0).total_seconds() / 3600, 0.5)
        n = rng.randint(14, 22) if site["cluster"]["id"] in CYBERJAYA + ["CL_KL_01", "CL_KL_02"] else rng.randint(5, 10)
        for _ in range(n):
            created = t0 + dt.timedelta(hours=rng.uniform(0.2, hours))
            case(site, min(created, ref_dt), weighted(rng, [("Data", 0.45), ("Coverage", 0.35), ("Voice", 0.2)]),
                 "Outage", km=1.2, status="Open")

    # slow-burn congestion and indoor coverage complaints over the last fortnight
    for cid, n, case_type, root in [("CL_KL_02", 70, "Congestion", "Congestion"), ("CL_KL_01", 55, "Congestion", "Congestion"),
                                    ("CL_SL_06", 60, "Coverage", "Indoor coverage"), ("CL_SL_06", 35, "Data", "Congestion"),
                                    ("CL_KL_03", 20, "Coverage", "Indoor coverage")]:
        for _ in range(n):
            case(rng.choice(sites[cid]), ref_dt - dt.timedelta(days=rng.uniform(0, 14), hours=rng.uniform(0, 12)),
                 case_type, root)
    ctx.hotspot_thd = rows

    # VIP tickets: a recent cluster around the hotspots plus some history
    vip = [(ref_dt - dt.timedelta(days=rng.uniform(0, 3)), rng.choice(live)) for _ in range(12)]
    vip += [(ref_dt - dt.timedelta(days=rng.uniform(0, 30)), pick_site()) for _ in range(20)]
    vip += [(ref_dt - dt.timedelta(days=rng.uniform(30, 150)), pick_site()) for _ in range(25)]
    ctx.hotspot_vip = vip

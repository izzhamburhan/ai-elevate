"""Subscriber side of the synthetic dataset: a population of subscribers whose
daily movement drives sessions, signal samples, usage, calls and the NBA
upstream tables; plus VIP tickets and the advisory / ML reference tables."""

import datetime as dt
import math

from netops_mcp import geo
from netops_mcp.seed import reference as R
from netops_mcp.seed.util import bulk_insert, clamp, iso, rsrp_at, weighted

N_SUBSCRIBERS = 60
HISTORY_DAYS = 30

# The first subscriber uses the identifiers from the real test fixtures so
# tool defaults resolve to data.
DEFAULT_IMSI = "502153000002017"
DEFAULT_MSISDN = "601110002356"


def _serving(ctx, sub, lat, lng, allow_2g=False):
    """Pick the serving site/cell/technology for a subscriber at a location."""
    rng = ctx.rng
    if allow_2g and rng.random() < 0.08 and ctx.sites2g:
        s = ctx.index2g.nearest(lat, lng)[0]
        return {"site_id": s["id"], "cell": f"{s['id']}_1", "tech": "2G", "rat": "GERAN", "mnc": 19,
                "freq": "GSM900", "lat": s["lat"], "lng": s["lng"], "cluster": s["cluster"]["name"],
                "enb": None, "eci": None, "site": s}
    tm = ctx.index4g.nearest(lat, lng)[0]
    d_tm = geo.haversine_km(lat, lng, tm["lat"], tm["lng"])
    if sub["persona"] == "rural_mocn" or d_tm > 3.0:
        m = ctx.index_mocn.nearest(lat, lng)
        if m and (sub["persona"] == "rural_mocn" or geo.haversine_km(lat, lng, m[0]["lat"], m[0]["lng"]) < d_tm):
            s = m[0]
            cell = min(s["cells"], key=lambda c: abs((_brg(s, lat, lng) - c["azimuth"] + 180) % 360 - 180))
            return {"site_id": s["id"], "cell": cell["name"], "tech": "4G_MOCN MAXIS", "rat": "EUTRAN", "mnc": 19,
                    "freq": "FDD1800", "lat": s["lat"], "lng": s["lng"], "cluster": s["cluster"]["name"],
                    "enb": s["enb"], "eci": s["enb"] * 256 + cell["cell_id"], "site": s, "cell_local": cell["cell_id"]}
    if sub["five_g"] and ctx.sites5g:
        near5 = ctx.index5g.nearest(lat, lng)
        g = near5[0] if near5 else None
        if g and geo.haversine_km(lat, lng, g["lat"], g["lng"]) < 1.0 and rng.random() < 0.6:
            cell = min(g["cells"], key=lambda c: abs((_brg(g, lat, lng) - c["azimuth"] + 180) % 360 - 180))
            local = int(cell["site_cell_id"].rsplit("_", 1)[1])
            return {"site_id": g["id"], "cell": cell["site_cell_id"], "tech": "5G_DNB", "rat": "NR", "mnc": 152,
                    "freq": "n78", "lat": g["lat"], "lng": g["lng"], "cluster": g["cluster"]["name"],
                    "enb": g["enb"], "eci": g["enb"] * 256 + local, "site": g, "cell_local": local}
    cell = min((c for c in tm["cells"]), key=lambda c: abs((_brg(tm, lat, lng) - c["azimuth"] + 180) % 360 - 180))
    return {"site_id": tm["id"], "cell": cell["site_cell_id"], "tech": "4G_TM", "rat": "EUTRAN", "mnc": 153,
            "freq": cell["band"], "lat": tm["lat"], "lng": tm["lng"], "cluster": tm["cluster"]["name"],
            "enb": tm["enb"], "eci": cell["eci"], "site": tm, "cell_local": cell["eci"] - tm["enb"] * 256}


def _brg(site, lat, lng):
    from netops_mcp.seed.util import bearing
    return bearing(site["lat"], site["lng"], lat, lng)


def _point_near(rng, lat, lng, km):
    return geo.offset(lat, lng, rng.uniform(0, 360), abs(rng.gauss(0, km)))


def build_subscribers(ctx):
    rng, ref = ctx.rng, ctx.ref
    clusters = list(ctx.clusters.values())
    mocn_clusters = [c for c in clusters if c["morph"] in ("Sub Urban", "Rural")]
    region_clusters = {}
    for c in clusters:
        region_clusters.setdefault(c["region"], []).append(c)
    outage_sites = [ctx.site_by_id[s] for s in ctx.open_outage_sites if s in ctx.site_by_id]
    congested_sites = [ctx.site_by_id[r[0]] for r in ctx.con.execute(
        "SELECT DISTINCT Site_ID FROM Site4G WHERE Status = 'Congested'").fetchall()]

    subs = []
    used_imsi, used_msisdn = set(), set()
    for i in range(N_SUBSCRIBERS):
        persona = "normal" if i == 0 else weighted(rng, R.PERSONAS)
        if i == 0:
            imsi, msisdn = DEFAULT_IMSI, DEFAULT_MSISDN
        else:
            while True:
                imsi = f"502153{rng.randint(0, 999_999_999):09d}"
                msisdn = f"6011{rng.randint(0, 99_999_999):08d}"
                if imsi not in used_imsi and msisdn not in used_msisdn:
                    break
        used_imsi.add(imsi)
        used_msisdn.add(msisdn)

        if persona == "rural_mocn":
            home_c = rng.choice(mocn_clusters)
        elif i == 0:
            home_c = ctx.clusters["CL_SL_01"]
        else:
            home_c = rng.choices(clusters, weights=[3 if c["region"] == "Central" else 1 for c in clusters])[0]
        nearby = [c for c in region_clusters[home_c["region"]]
                  if geo.haversine_km(c["lat"], c["lng"], home_c["lat"], home_c["lng"]) < 40]
        work_c = home_c if rng.random() < 0.4 else rng.choice(nearby)
        spread = R.MORPH_SPREAD_KM[home_c["morph"]]
        home = _point_near(rng, home_c["lat"], home_c["lng"], spread)
        work = _point_near(rng, work_c["lat"], work_c["lng"], R.MORPH_SPREAD_KM[work_c["morph"]] * 0.7)
        if persona == "outage_affected" and outage_sites:
            s = rng.choice(outage_sites)
            home = geo.offset(s["lat"], s["lng"], rng.uniform(0, 360), 0.25)
            home_c = s["cluster"]
        if persona == "congestion_work" and congested_sites:
            s = rng.choice(congested_sites)
            work = geo.offset(s["lat"], s["lng"], rng.uniform(0, 360), 0.2)
            work_c = s["cluster"]
        device = rng.choice(R.DEVICES[:3] + R.DEVICES[3:7]) if i == 0 else rng.choice(R.DEVICES)
        postpaid = rng.random() < 0.6
        plan = rng.choice(R.PLANS_POSTPAID if postpaid else R.PLANS_PREPAID)
        five_g = device[4] and "UNI5G" in plan
        leisure = [_point_near(rng, home_c["lat"], home_c["lng"], spread * 1.2) for _ in range(3)]
        name = rng.choice(R.PERSON_NAMES) if i else "Ahmad Faizal"
        subs.append({
            "i": i, "imsi": imsi, "msisdn": msisdn, "persona": persona, "home": home, "work": work,
            "home_c": home_c, "work_c": work_c, "leisure": leisure, "device": device, "postpaid": postpaid,
            "plan": plan, "five_g": five_g, "name": name,
            "imei": f"35{rng.randint(10 ** 12, 10 ** 13 - 1)}",
            "subs_id": f"S{100000 + i}",
            "weekday_work": persona != "barred" and rng.random() < 0.85,
        })
    ctx.subscribers = subs

    crm, device_rows = [], []
    sessions, geoloc, speedtests, apps, volte, sms = [], [], [], [], [], []
    lte_daily, dr_daily, voice_cdr, short_cdr = [], [], [], []
    for sub in subs:
        status = "BARRED" if sub["persona"] == "barred" else "ACTIVE"
        crm.append((sub["imsi"], sub["msisdn"], sub["name"], "Consumer" if rng.random() < 0.85 else "SME",
                    "POSTPAID" if sub["postpaid"] else "PREPAID", sub["plan"], status, sub["home_c"]["state"],
                    ref - dt.timedelta(days=1)))
        brand, model, dtype, os_, volte_cap = sub["device"]
        device_rows.append((sub["imsi"], ref - dt.timedelta(days=1), sub["imei"], brand, model, dtype, os_,
                            1 if volte_cap or brand in ("Apple", "Samsung") else 0, int(rng.random() < 0.3)))
        if sub["persona"] == "barred":
            continue  # barred lines produce no traffic
        _simulate(ctx, sub, sessions, geoloc, speedtests, apps, volte, sms, lte_daily, dr_daily, voice_cdr, short_cdr)

    con = ctx.con
    bulk_insert(con, "zl_crm", ["imsi", "msisdn", "customer_name", "segment", "service_type", "plan_name",
                                "subscriber_status", "home_state", "date"], crm)
    bulk_insert(con, "zl_device", ["imsi", "date", "imei", "device_brand", "device_model", "device_type", "device_os",
                                   "volte", "tethering"], device_rows)
    bulk_insert(con, "zl_session", ["imsi", "ts", "ts_end", "site_id", "bearer_cell", "cluster", "cell_technology",
                                    "signal_type", "rat", "mnc", "cell_frequency", "bytes_dl", "bytes_ul",
                                    "peak_dl_mbps", "peak_ul_mbps"], sessions)
    bulk_insert(con, "zl_geoloc", ["imsi", "ts", "site_id", "latitude", "longitude", "rsrp", "sinr"], geoloc)
    bulk_insert(con, "zl_speedtest", ["imsi", "ts", "dl_bps", "ul_bps", "host", "cell_technology", "site_id"],
                speedtests)
    bulk_insert(con, "zl_app_usage", ["imsi", "date", "app_name", "bytes"], apps)
    bulk_insert(con, "zl_volte", ["msisdn", "ts", "call_type", "call_id", "mos", "attempts", "answered", "drops"], volte)
    bulk_insert(con, "zl_sms", ["imsi", "date", "sms_mo", "sms_mt"], sms)
    bulk_insert(con, "ime_lte_daily", ["id", "start_time", "msisdn", "imsi", "imei", "duration", "lac", "cell",
                                             "eci", "enodeb_id", "mccmnc", "mccmnc_tai", "apn", "data_mode",
                                             "uplink_bytes", "downlink_bytes", "total_usage_bytes"], lte_daily)
    bulk_insert(con, "IMEDRDailyUsage", ["id", "start_time", "msisdn", "imsi", "cell", "lac", "duration", "data_mode",
                                         "total_usage_bytes", "site_id"], dr_daily)
    bulk_insert(con, "voice_cdr_daily", ["id", "call_date", "subs_id", "msisdn", "total_duration_sec",
                                               "avg_duration_sec", "total_call_count", "lac_a", "cell_a", "mncmcc",
                                               "network_type"], voice_cdr)
    bulk_insert(con, "short_voice_cdr_daily", ["id", "call_date", "subs_id", "msisdn", "total_sc_duration_sec",
                                                     "avg_sc_duration_sec", "total_sc_count", "lac_a", "cell_a",
                                                     "enodeb_id", "mncmcc", "network_type"], short_cdr)
    _nba_profile_tables(ctx, subs)


def _day_plan(rng, sub, day):
    """List of (start_hour, end_hour, (lat, lng), place) for one day."""
    weekend = day.weekday() >= 5
    home, work = sub["home"], sub["work"]
    j = lambda: rng.uniform(-0.3, 0.3)  # noqa: E731
    if weekend or not sub["weekday_work"]:
        plan = [(0, 10 + j(), home, "home")]
        t = plan[-1][1]
        for _ in range(rng.randint(1, 2)):
            dur = rng.uniform(1.5, 3.5)
            plan.append((t, t + dur, rng.choice(sub["leisure"]), "leisure"))
            t += dur
        plan.append((t, 24, home, "home"))
        return plan
    lerp = lambda a, b, f: (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)  # noqa: E731
    wp1, wp2 = lerp(home, work, 0.35), lerp(home, work, 0.7)
    lunch = geo.offset(work[0], work[1], rng.uniform(0, 360), rng.uniform(0.2, 0.8))
    plan = [
        (0, 7.4 + j(), home, "home"),
        (None, 8.0 + j() / 2, wp1, "commute"),
        (None, 8.8 + j() / 2, wp2, "commute"),
        (None, 12.5, work, "work"),
        (None, 13.5, lunch, "lunch"),
        (None, 17.8 + j(), work, "work"),
        (None, 18.4 + j() / 2, wp2, "commute"),
        (None, 19.0 + j() / 2, wp1, "commute"),
    ]
    if rng.random() < 0.3:
        plan.append((None, 21.5, rng.choice(sub["leisure"]), "leisure"))
    plan.append((None, 24, home, "home"))
    out, t = [], 0.0
    for start, end, pt, place in plan:
        out.append((t, max(end, t + 0.25), pt, place))
        t = max(end, t + 0.25)
    return out


def _simulate(ctx, sub, sessions, geoloc, speedtests, apps, volte, sms, lte_daily, dr_daily, voice_cdr, short_cdr):
    rng, ref = ctx.rng, ctx.ref
    persona = sub["persona"]
    heavy = 3.0 if persona == "heavy_user" else 1.0
    for back in range(HISTORY_DAYS, 0, -1):
        day = ref - dt.timedelta(days=back)
        midnight = dt.datetime.combine(day, dt.time())
        day_bytes = 0
        per_cell = {}
        merged = []
        for start, end, (lat, lng), place in _day_plan(rng, sub, day):
            srv = _serving(ctx, sub, lat, lng, allow_2g=place in ("commute", "lunch", "leisure"))
            if merged and merged[-1]["srv"]["cell"] == srv["cell"]:
                merged[-1]["end"] = end
                continue
            merged.append({"start": start, "end": end, "lat": lat, "lng": lng, "place": place, "srv": srv})
        for seg in merged:
            srv = seg["srv"]
            ts = midnight + dt.timedelta(hours=seg["start"])
            ts_end = midnight + dt.timedelta(hours=min(seg["end"], 23.999))
            hours = max((ts_end - ts).total_seconds() / 3600, 0.05)
            d_km = geo.haversine_km(seg["lat"], seg["lng"], srv["lat"], srv["lng"])
            indoor = {"home": 8, "work": 6, "lunch": 3, "leisure": 4}.get(seg["place"], 0)
            if persona == "poor_coverage_home" and seg["place"] == "home":
                indoor += 20
            base_rsrp = rsrp_at(d_km) - indoor + (4 if srv["tech"] == "5G_DNB" else 0)
            congested = persona == "congestion_work" and seg["place"] in ("work", "lunch")
            outage = persona == "outage_affected" and seg["place"] == "home" and back <= 2
            rate_mb_h = (20 if seg["place"] in ("home", "leisure") else 8) * heavy * rng.uniform(0.5, 1.5)
            if seg["place"] == "home" and seg["start"] < 6:
                rate_mb_h *= 0.15
            if congested or outage:
                rate_mb_h *= 0.3
            mb = rate_mb_h * hours
            dl = int(mb * 0.88 * 1e6)
            ul = int(mb * 0.12 * 1e6)
            day_bytes += dl + ul
            peak = {"5G_DNB": 380, "4G_TM": 45, "4G_MOCN MAXIS": 30, "2G": 0.2}[srv["tech"]]
            peak *= clamp((base_rsrp + 125) / 45, 0.05, 1.2) * (0.25 if congested else 1) * rng.uniform(0.6, 1.2)
            sessions.append((sub["imsi"], ts, ts_end, srv["site_id"], srv["cell"], srv["cluster"], srv["tech"],
                             {"5G_DNB": "NR NSA", "2G": "GSM"}.get(srv["tech"], "LTE"), srv["rat"], srv["mnc"],
                             srv["freq"], dl, ul, round(peak, 3), round(peak * 0.25, 3)))
            # signal samples roughly every hour
            t = seg["start"]
            while t < seg["end"]:
                rsrp = clamp(base_rsrp + rng.gauss(0, 3.5), -140, -44)
                plat, plng = geo.offset(seg["lat"], seg["lng"], rng.uniform(0, 360), rng.uniform(0, 0.08))
                geoloc.append((sub["imsi"], midnight + dt.timedelta(hours=t), srv["site_id"], round(plat, 6),
                               round(plng, 6), round(rsrp, 1), round(clamp((rsrp + 112) / 2.2 + rng.gauss(0, 2), -5, 30), 1)))
                t += rng.uniform(0.7, 1.5)
            if srv["tech"] != "2G" and rng.random() < 0.04:
                speedtests.append((sub["imsi"], ts + dt.timedelta(minutes=rng.randint(1, 30)),
                                   int(peak * 1_048_576 * rng.uniform(0.6, 0.95)),
                                   int(peak * 0.25 * 1_048_576 * rng.uniform(0.6, 0.95)),
                                   rng.choice(["ookla", "fast.com", "speedtest.unifi.com.my"]), srv["tech"],
                                   srv["site_id"]))
            key = srv["cell"]
            acc = per_cell.setdefault(key, {"srv": srv, "dur": 0, "dl": 0, "ul": 0})
            acc["dur"] += int(hours * 3600)
            acc["dl"] += dl
            acc["ul"] += ul

        # NBA session tables (one row per day per cell)
        for acc in per_cell.values():
            srv = acc["srv"]
            if srv["tech"] == "2G":
                dr_daily.append((len(dr_daily) + 1, day.isoformat(), sub["msisdn"], sub["imsi"], srv["cell"],
                                 str(10000 + sum(map(ord, srv["site_id"])) % 9999), acc["dur"], "DR_2G", acc["dl"] + acc["ul"],
                                 srv["site_id"]))
                continue
            mode = {"4G_TM": "LTE", "4G_MOCN MAXIS": rng.choice(["4G_M", "4G_M_DR"]), "5G_DNB": "DNB"}[srv["tech"]]
            lte_daily.append((len(lte_daily) + 1, day.isoformat(), sub["msisdn"], sub["imsi"], sub["imei"], acc["dur"],
                              str(53000 + srv["enb"] % 97), str(srv.get("cell_local")), str(srv["eci"]),
                              str(srv["enb"]), f"502{srv['mnc']:03d}", f"502{srv['mnc']:03d}", "unifi",
                              mode, acc["ul"], acc["dl"], acc["ul"] + acc["dl"]))

        # app usage split
        weights = list(R.APP_WEIGHT)
        for app, w in zip(R.APPS, weights):
            b = int(day_bytes * w * rng.uniform(0.6, 1.4))
            if b > 0:
                apps.append((sub["imsi"], day, app, b))

        # voice & sms
        n_calls = max(0, int(rng.gauss(5, 2.5)))
        volte_cap = sub["device"][4] or sub["device"][0] in ("Apple", "Samsung")
        total_dur = 0.0
        short_calls = 0
        for c in range(n_calls):
            call_type = "VoLTE" if volte_cap and rng.random() < 0.85 else "DR"
            bad = persona == "volte_issue"
            mos = clamp(rng.gauss(2.4 if bad else 4.0, 0.4), 1.0, 4.5)
            drops = 1 if rng.random() < (0.35 if bad else 0.03) else 0
            attempts = 1 + (1 if rng.random() < (0.4 if bad else 0.05) else 0)
            volte.append((sub["msisdn"], midnight + dt.timedelta(hours=rng.uniform(8, 22)), call_type,
                          f"CALL-{sub['i']:03d}-{day:%m%d}-{c:02d}", round(mos, 2), attempts, 1, drops))
            dur = rng.uniform(5, 25) if (bad and rng.random() < 0.5) else rng.uniform(30, 600)
            total_dur += dur
            if dur < 30:
                short_calls += 1
        sms.append((sub["imsi"], day, rng.randint(0, 12), rng.randint(2, 40)))
        home_srv = merged[0]["srv"] if merged else None
        cell_a = home_srv["cell"] if home_srv else None
        if n_calls:
            voice_cdr.append((len(voice_cdr) + 1, day.isoformat(), sub["subs_id"], sub["msisdn"], round(total_dur, 1),
                              round(total_dur / n_calls, 1), n_calls, "53013", cell_a, "502153", "VoLTE"))
        if short_calls:
            short_cdr.append((len(short_cdr) + 1, day.isoformat(), sub["subs_id"], sub["msisdn"],
                              round(short_calls * 15.0, 1), 15.0, str(short_calls), "53013", cell_a,
                              str(home_srv["enb"]) if home_srv else None, "502153", "VoLTE"))


def _nba_profile_tables(ctx, subs):
    rng, ref, ref_dt = ctx.rng, ctx.ref, ctx.ref_dt
    profiles, passes, cases, thd_cases = [], [], [], []
    case_id = 7_000_000
    for sub in subs:
        persona = sub["persona"]
        line = {"barred": "Barred"}.get(persona, "Active")
        act = ref - dt.timedelta(days=rng.randint(200, 2000))
        street = rng.choice(R.STREETS)
        profiles.append((sub["subs_id"], sub["msisdn"], ref_dt - dt.timedelta(days=1), sub["imsi"], sub["name"],
                         f"No. {rng.randint(1, 200)}, {street}, {sub['home_c']['name']}, {sub['home_c']['state'].title()}",
                         act.isoformat(), None, None, line, "Barred - Non Payment" if line == "Barred" else "Active",
                         "POSTPAID" if sub["postpaid"] else "PREPAID", "Unifi Mobile",
                         "Consumer", "CNS", f"OFR{rng.randint(1000, 9999)}", sub["plan"], rng.randint(1, 28),
                         "Individual", sub["home_c"]["state"], act.isoformat(), (act + dt.timedelta(days=730)).isoformat(),
                         (ref - dt.timedelta(days=rng.randint(1, 30))).isoformat(), round(rng.uniform(20, 150), 2),
                         (ref - dt.timedelta(days=rng.randint(1, 30))).isoformat(), round(rng.uniform(20, 150), 2),
                         round(rng.uniform(0, 300) if line == "Barred" else 0, 2)))
        # passes: data, voice, sms
        eff = ref - dt.timedelta(days=rng.randint(1, 25))
        exp = eff + dt.timedelta(days=30)
        gross = rng.choice([50e9, 100e9, 200e9]) if sub["postpaid"] else rng.choice([10e9, 20e9, 35e9])
        used = gross if persona == "quota_exhausted" else gross * rng.uniform(0.05, 0.9)
        passes.append((float(sub["i"]), sub["msisdn"], gross, used, gross - used, f"{sub['plan']} Data",
                       "Data Volume", eff.isoformat(), exp.isoformat(), ref.isoformat()))
        vgross = 18000.0
        vused = vgross * rng.uniform(0.0, 0.6)
        passes.append((float(sub["i"]), sub["msisdn"], vgross, vused, vgross - vused, "Unlimited Calls",
                       "Voice Minutes", eff.isoformat(), exp.isoformat(), ref.isoformat()))
        sgross = 300.0
        sused = float(rng.randint(0, 120))
        passes.append((float(sub["i"]), sub["msisdn"], sgross, sused, sgross - sused, "SMS Bundle", "SMS Count",
                       eff.isoformat(), exp.isoformat(), ref.isoformat()))
        # customer cases: complainers get recent open cases
        n_cases = 1 if persona == "normal" else rng.randint(1, 3)
        for k in range(n_cases):
            case_id += rng.randint(1, 50)
            created = ref_dt - dt.timedelta(days=rng.uniform(0.5, 50))
            recent = (ref_dt - created).days < 7
            status = rng.choice(["Open", "In Progress"]) if recent and persona != "normal" else rng.choice(["Closed", "Resolved"])
            cases.append((float(case_id), sub["msisdn"], sub["name"], "Active", line, status, created,
                          created + dt.timedelta(hours=rng.uniform(1, 72)),
                          rng.choice(["Network - Coverage", "Network - Data Speed", "Network - Voice", "Billing"]),
                          rng.choice(["Technical", "Complaint"]), rng.choice(["Low", "Medium", "High"]),
                          rng.choice(["P3", "P2", "P1"]), rng.choice(["Call Centre", "Unifi App", "Store"]), 4, "Hours"))
        brand, model, dtype, _os, _v = sub["device"]
        thd_cases.append((case_id, sub["msisdn"], (ref_dt - dt.timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S"),
                          brand, model, dtype, "Network", f"{sub['home'][0]:.5f},{sub['home'][1]:.5f}"))
    con = ctx.con
    bulk_insert(con, "subs_profile_daily",
                ["subs_id", "msisdn", "case_created_on", "imsi", "customer_name", "address", "line_activation_date",
                 "line_termination_date", "line_termination_reason", "line_status", "account_status",
                 "pay_type_description", "product_group", "segment", "segment_code", "offer_code", "offer_name",
                 "bill_cycle_day", "customer_type", "billing_state", "contract_start_date", "contract_end_date",
                 "last_payment_date", "last_payment_amount", "latest_bill_date", "latest_billed_amount",
                 "latest_account_os"], profiles)
    bulk_insert(con, "pass_quota_daily", ["subs_id", "msisdn", "gross_bal", "consume_bal", "remaining_bal",
                                                "pass_name", "pass_acct_item_type_name", "eff_date", "exp_date",
                                                "updated_date"], passes)
    bulk_insert(con, "case_view_daily", ["case_id", "msisdn", "cust_name", "account_status", "line_status",
                                               "case_status", "case_created_on", "case_modified_on", "case_sub_area",
                                               "case_category", "severity", "priority", "case_channel", "sla_time",
                                               "sla_unit"], cases)
    bulk_insert(con, "case_thd_daily", ["case_id", "service_number", "created_time", "phone_type",
                                              "phone_model", "device_characteristic", "case_category",
                                              "complaint_loc_latlong"], thd_cases)


# ---------------------------------------------------------------------------
# VIP tickets
# ---------------------------------------------------------------------------
TINY_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360f8cfc0000003010100c9fe92ef0000000049454e44ae426082"
)


def build_vip_tickets(ctx):
    rng, ref_dt = ctx.rng, ctx.ref_dt
    con = ctx.con
    bulk_insert(con, "auth_group", ["id", "name"], [(g, n) for g, n, _ in R.TICKET_GROUPS])
    bulk_insert(con, "Groups", ["group_ptr_id", "email"], [(g, e) for g, _, e in R.TICKET_GROUPS])

    start = dt.datetime(ref_dt.year - 1, 6, 1)
    span = (ref_dt - start).total_seconds()
    times = sorted(start + dt.timedelta(seconds=span * (rng.random() ** 0.7)) for _ in range(220))
    tickets, esc_rows, fb_rows, att_rows, mail_rows = [], [], [], [], []
    running = 300
    fid = eid = aid = 0
    for tid, complained in enumerate(times, start=1):
        complained = complained.replace(second=0, microsecond=0)
        running += 1
        ctt = "VCTT" if rng.random() < 0.7 else "ECTT"
        ctt2 = f"{ctt}/{complained.year}/{complained.month}/{running}"
        age_days = (ref_dt - complained).days
        status = weighted(rng, R.TT_STATUS) if age_days < 21 else weighted(rng, [("Closed", 0.85), ("Completed PSC", 0.15)])
        problem, rc1, rc2 = rng.choice(R.VIP_PROBLEMS)
        site = rng.choice(ctx.sites4g)
        lat, lng = geo.offset(site["lat"], site["lng"], rng.uniform(0, 360), rng.uniform(0.05, 0.8))
        escalated = complained + dt.timedelta(hours=rng.uniform(0.2, 5))
        resolved = escalated + dt.timedelta(hours=rng.uniform(2, 96)) if status in ("Closed", "Completed PSC") else None
        if resolved and resolved > ref_dt:
            resolved = ref_dt - dt.timedelta(hours=1)
        esc_h = round((escalated - complained).total_seconds() / 3600, 2)
        res_h = round((resolved - complained).total_seconds() / 3600, 2) if resolved else None
        brand, model = rng.choice(R.DEVICES)[:2]
        customer = rng.choice(["Dato Sri ", "Datuk ", "Tan Sri ", "Encik ", "Puan ", ""]) + rng.choice(R.PERSON_NAMES)
        groups = rng.sample([g for g, _, _ in R.TICKET_GROUPS if g != 9], k=rng.randint(1, 3))
        group_names = {g: n for g, n, _ in R.TICKET_GROUPS}
        fb_text = {
            "NQO": "Drive test done, RSRP -108 dBm indoor. Recommend IBC.",
            "Planner": "Site in AOP list for capacity upgrade next quarter.",
            "Rollout": "TDD2600 carrier rollout scheduled.",
            "IMS Core": "No IMS registration failure observed for this MSISDN.",
            "PS Core": "PGW session normal, no throttling observed.",
            "SOC": "No alarms on serving site during complaint window.",
            "Celcom": "DR coverage verified in area.",
            "DNB": "5G cell parameters re-tuned.",
        }
        tickets.append((
            tid, rng.choice(["L1 verified", "L1 pending", None]), ctt2, rng.choice(R.PSC_PICS), status,
            iso(complained.date())[1], rng.choice(["Careline", "VIP Group"]), customer,
            rng.choice(["Coverage", "Enquiry"]), f"Customer reports: {problem.lower()} at {site['cluster']['name']}.",
            f"6011{rng.randint(0, 99_999_999):08d}", brand, model, problem,
            f"{rng.choice(R.STREETS)}, {site['cluster']['name']}, {site['state'].title()}", round(lat, 6), round(lng, 6),
            complained, escalated, resolved, res_h, esc_h, site["id"], f"{site['id']}-{rng.randint(1, 3)}",
            site["cluster"]["name"], site["region"], site["state"].title(),
            f"Serving site {site['id']} {rc2.lower()} observed.", f"{rng.uniform(97, 100):.2f}%",
            f"{rng.uniform(0, 2):.2f}%", round(rng.uniform(20, 98), 2),
            f"NTT-{complained:%Y%m%d}-{rng.randint(10000, 99999)}" if rc2 == "Site outage" else None,
            rng.choice(["Yes", "No"]),
            *[fb_text[group_names[g]] if g in groups else None for g in range(1, 9)],
            f"Root cause: {rc2}." if resolved else None,
            rng.choice(["Add IBC", "Optimise tilt", "Capacity upgrade", "Device reset advised"]),
            None, rc1, rc2, ctt, complained.month, complained.year, running,
            rng.choice(["4G", "4G", "5G"]), site["morph"],
            ("Within 8 hour" if res_h is not None and res_h <= 8 else "More than 8 hour") if res_h is not None else None,
            "Within 1 hour" if esc_h <= 1 else "More than 1 hour",
        ))
        for g in groups:
            eid += 1
            esc_rows.append((eid, tid, g))
            turns = rng.randint(1, 2)
            for turn in range(1, turns + 1):
                fid += 1
                created = escalated + dt.timedelta(hours=rng.uniform(1, 30) * turn)
                if created > ref_dt:
                    created = ref_dt - dt.timedelta(minutes=rng.randint(5, 600))
                closed = status in ("Closed", "Completed PSC") or turn < turns
                fb_rows.append((fid, tid, g, rng.choice(R.PERSON_NAMES), fb_text[group_names[g]],
                                f"Turn {turn}: {'investigation completed' if closed else 'pending site check'}.",
                                "Closed" if closed else "Open", str(turn), escalated,
                                created if closed else None, created, created))
            eid_mail = len(mail_rows) + 1
            mail_rows.append((eid_mail, tid, "escalation", "noc@example.com",
                              ",".join(e for gg, _, e in R.TICKET_GROUPS if gg == g), f"[NOC] - {ctt2}",
                              f"<p>Ticket {ctt2} has been escalated to your team.</p>", escalated))
        if rng.random() < 0.15:
            aid += 1
            csv = f"timestamp,rsrp,sinr\n{complained:%Y-%m-%d %H:%M},-108,2.5\n{complained:%Y-%m-%d %H:%M},-111,1.0\n"
            att_rows.append((aid, tid, "drive_test_summary.csv", "text/csv", len(csv), csv.encode(), "NOC Support",
                             escalated))
            if rng.random() < 0.5:
                aid += 1
                att_rows.append((aid, tid, "site_photo.png", "image/png", len(TINY_PNG), TINY_PNG, "NOC Support",
                                 escalated))
    bulk_insert(con, "THD_Ticket", [
        "id", "update_l1", "ctt2", "psc_pic", "tt_status", "week_no", "complaint_forward_by", "customer_name",
        "case_type", "user_details_complaint", "faulty_msisdn", "phone_brand", "phone_model", "problem",
        "faulty_location_address", "latitude", "longitude", "complaint_datetime", "escalation_datetime",
        "resolved_datetime", "resolved_hour", "escalation_hour", "site_id", "serving_cells", "cluster", "region",
        "state", "finding", "avg_cell_availability", "packet_loss", "prb_utilization", "ntt_number", "cell_upgrade",
        "nqo_feedback", "planner_feedback", "rollout_feedback", "ims_core_feedback", "ps_core_feedback",
        "soc_feedback", "celcom_feedback", "dnb_feedback", "conclusion", "recommendation", "notes", "root_cause1",
        "root_cause2", "ctt", "month", "year", "running_number", "site_technology", "morphology", "resolve_hour_kpi",
        "escalation_hour_kpi"], tickets)
    bulk_insert(con, "THD_Ticket_escalated_groups", ["id", "thdticket_id", "usergroup_id"], esc_rows)
    bulk_insert(con, "THD_Ticket_Feedback", ["id", "ticket_id", "group_id", "name", "feedback", "remark", "status",
                                             "turn", "open_date", "close_date", "created_at", "updated_at"], fb_rows)
    bulk_insert(con, "THD_Ticket_Email_Log", ["id", "ticket_id", "email_type", "sender", "recipients", "subject",
                                              "content", "created_at"], mail_rows)
    con.executemany("INSERT INTO THD_Ticket_Attachment VALUES (?, ?, ?, ?, ?, ?, ?, ?)", att_rows)


# ---------------------------------------------------------------------------
# Advisory and ML reference tables
# ---------------------------------------------------------------------------
ML_CLASSES = {
    "1": ("Line is not active (barred/passive/suspended).",
          "Check the customer's line status and any outstanding bill.",
          "Advise the customer to settle outstanding payment or contact billing to reactivate the line.",
          "No network action needed. Route to billing team."),
    "2": ("Data quota exhausted.",
          "Confirm remaining quota and active passes.",
          "Offer an add-on data pass or plan upgrade.",
          "No network action needed."),
    "3": ("Active network trouble ticket (outage) on the serving site.",
          "Check NTT status and ETTR for the serving site.",
          "Inform the customer of the ongoing outage and expected restoration time.",
          "Track NTT to closure; escalate if ETTR is breached."),
    "4": ("Serving site is congested.",
          "Check congestion status and PRB utilisation on the serving cells.",
          "Explain peak-hour congestion; suggest off-peak usage or Wi-Fi calling.",
          "Raise capacity upgrade / load-balancing request for the congested cells."),
    "5": ("Planned maintenance on the serving site.",
          "Check the RFC window for the serving site.",
          "Inform the customer of the maintenance window; service resumes after the RFC.",
          "Confirm RFC closure and post-check KPIs."),
    "6": ("Poor RF coverage (RSRP/SINR bad) at the customer's location.",
          "Review BIN RSRP/SINR around the customer's top sites.",
          "Advise on indoor coverage limits; suggest Wi-Fi calling or signal booster.",
          "Raise coverage optimisation (tilt/azimuth) or IBC/small-cell request."),
    "7": ("Account is terminated.",
          "Verify termination reason in CRM.",
          "Advise the customer to register a new line.",
          "No network action needed."),
    "8": ("Network KPI degradation on the serving site.",
          "Check cell availability, setup success and drop rates on the serving site.",
          "Acknowledge degraded service; network team is investigating.",
          "Raise performance ticket for KPI degradation on the site."),
    "9": ("High latency on 5G (DNB) connection.",
          "Check TWAMP latency for the serving 5G site.",
          "Advise the customer that 5G latency is being investigated by DNB.",
          "Escalate latency issue to DNB."),
    "10": ("VoLTE call issues (high short-call count).",
           "Check VoLTE short calls and call attempts for the MSISDN.",
           "Ask the customer to toggle VoLTE and update device software.",
           "Check IMS registration and VoLTE provisioning for the MSISDN."),
    "11": ("No network issue found.",
           "Review device settings and usage pattern.",
           "Guide the customer through device troubleshooting (restart, APN, network mode).",
           "No network action needed; close the case after customer confirmation."),
}

FEATURES = {
    "line_status": [("active", 0.85), ("barred", 0.04), ("passive", 0.03), ("suspended", 0.04), ("terminated", 0.04)],
    "quota_usage": [("yes", 0.88), ("no", 0.12)],
    "ntt_status": [("no", 0.88), ("active", 0.12)],
    "connection_type": [("tm4g", 0.6), ("4gmocn", 0.15), ("5g", 0.15), ("2g", 0.1)],
    "congestion_status": [("no", 0.85), ("yes", 0.15)],
    "plan_maintenance_status": [("no", 0.9), ("yes", 0.1)],
    "final_rsrp_status": [("good", 0.55), ("moderate", 0.2), ("bad", 0.15), ("not_related", 0.1)],
    "final_sinr_status": [("good", 0.55), ("moderate", 0.2), ("bad", 0.15), ("not_related", 0.1)],
    "usage_volume": [("low", 0.3), ("medium", 0.4), ("high", 0.3)],
    "volte_total_short_calls_range": [("low", 0.7), ("medium", 0.2), ("high", 0.1)],
    "volte_total_call_attempt_range": [("low", 0.5), ("medium", 0.3), ("high", 0.2)],
    "overall_kpistatus_for_all_provider": [("good", 0.85), ("bad", 0.15)],
    "latency_range": [("not_related", 0.7), ("good", 0.2), ("bad", 0.1)],
}


def label_features(f: dict) -> str:
    if f["line_status"] == "terminated":
        return "7"
    if f["line_status"] in ("barred", "passive", "suspended"):
        return "1"
    if f["quota_usage"] == "no":
        return "2"
    if f["ntt_status"] == "active":
        return "3"
    if f["plan_maintenance_status"] == "yes":
        return "5"
    if f["congestion_status"] == "yes":
        return "4"
    if "bad" in (f["final_rsrp_status"], f["final_sinr_status"]):
        return "6"
    if f["overall_kpistatus_for_all_provider"] == "bad":
        return "8"
    if f["latency_range"] == "bad":
        return "9"
    if f["volte_total_short_calls_range"] == "high":
        return "10"
    return "11"


def apply_overrides(f: dict) -> dict:
    """Same override rules the runtime applies before the KNN lookup."""
    f = dict(f)
    if f["line_status"] in ("barred", "passive", "suspended"):
        return {k: (v if k == "line_status" else "na") for k, v in f.items()}
    if f["quota_usage"] == "no":
        return {k: (v if k == "quota_usage" else "na") for k, v in f.items()}
    if f["ntt_status"] == "active":
        return {k: (v if k == "ntt_status" else "na") for k, v in f.items()}
    return f


def build_advisory(ctx):
    rng, con, now = ctx.rng, ctx.con, ctx.ref_dt
    rows = []
    for i in range(1, 701):
        f = {k: weighted(rng, v) for k, v in FEATURES.items()}
        if f["connection_type"] != "5g":
            f["latency_range"] = "not_related"
        if f["connection_type"] != "tm4g":
            f["final_rsrp_status"] = f["final_sinr_status"] = "not_related"
        label = label_features(f)
        f = apply_overrides(f)
        rows.append((i, *f.values(), label))
    bulk_insert(con, "ml_model_training", ["id", *FEATURES.keys(), "cluster"], rows)
    bulk_insert(con, "ml_nba_advisory", ["id", "class_name", "summary", "prompt", "action_cx", "action_thd"],
                [(i, k, *v) for i, (k, v) in enumerate(ML_CLASSES.items(), start=1)])

    # Mobile dashboard matrix: one canonical row per class
    matrix = [
        # line, conn, rsrp, ntt, cong, pm, dl, ul, vol, mos_dr, mos_volte, drop_dr, drop_volte, sms
        ("Active", "4G_TM", "Good", False, False, False, "High", "High", "Medium", "Good", "Good", "Excellent", "Excellent", "Low"),
        ("Active", "4G_TM", "Very Bad", False, False, False, "Low", "Low", "Low", "Moderate", "Bad", "Low", "Medium", "Low"),
        ("Active", "4G_TM", "Good", True, False, False, "Low", "Low", "Low", "Bad", "Bad", "High", "High", "Low"),
        ("Active", "4G_TM", "Good", False, True, False, "Low", "Medium", "High", "Good", "Moderate", "Low", "Low", "Low"),
        ("Active", "4G_TM", "Good", False, False, True, "Low", "Low", "Low", "Good", "Good", "Low", "Low", "Low"),
        ("Active", "4G_MOCN MAXIS", "Moderate", False, False, False, "Medium", "Medium", "Medium", "Good", "Good", "Excellent", "Excellent", "Low"),
        ("Active", "5G_DNB", "Very Good", False, False, False, "High", "High", "High", "Good", "Good", "Excellent", "Excellent", "Low"),
        ("Active", "4G_TM", "Good", False, False, False, "High", "High", "Medium", "Good", "Bad", "Excellent", "High", "Low"),
        ("Barred", "4G_TM", "Good", False, False, False, "Low", "Low", "Low", "Good", "Good", "Excellent", "Excellent", "Low"),
    ]
    adv = [
        ("No network issue detected.", "Ask the customer about device settings and recent changes.",
         "Guide device troubleshooting: restart, reset network settings, check APN.",
         "Signal, speed and voice quality are all within normal range."),
        ("Poor indoor coverage at the customer's frequent location.", "Confirm where the issue happens (indoor/outdoor).",
         "Recommend Wi-Fi calling; log a coverage complaint for optimisation.",
         "RSRP at the top visited site is very bad; speeds are low."),
        ("Outage (NTT) on a visited site.", "Confirm the customer was near the affected site.",
         "Inform the customer of the outage and expected restoration time.",
         "An active NTT exists on a site the subscriber visited recently."),
        ("Congestion on a visited site.", "Confirm whether slowness happens at peak hours.",
         "Explain congestion and advise off-peak usage; capacity upgrade is planned.",
         "A visited site is congested; download speeds are low despite good signal."),
        ("Planned maintenance on a visited site.", "Check the maintenance window against complaint time.",
         "Inform the customer that service was affected by planned maintenance.",
         "An RFC was being implemented on a visited site."),
        ("Customer is on MOCN (partner) coverage.", "Check whether the customer is outside TM 4G coverage.",
         "Explain MOCN coverage; suggest checking coverage map.",
         "Most traffic is carried on MOCN partner sites."),
        ("No issue on 5G.", "Confirm the customer's 5G experience.",
         "No action needed; share 5G tips.",
         "Customer is on 5G with very good signal and high speeds."),
        ("VoLTE voice quality issue.", "Ask about call drops and voice clarity.",
         "Ask the customer to toggle VoLTE and update device software; escalate to IMS if persists.",
         "VoLTE MOS is bad and VoLTE call drops are high."),
        ("Line is barred.", "Check outstanding bill and barring reason.",
         "Advise payment or contact billing to reactivate.",
         "The line status is barred; no traffic is possible."),
    ]
    bulk_insert(con, "nba_matrix", [
        "id", "line_status", "internet_connection_matrix", "user_coverage_signal_strength_rsrp",
        "ntt_site_outage_status", "site_congestion_status", "plan_maintenance", "max_download_speed_megabits",
        "max_upload_speed_megabits", "total_volume_megabytes", "mos_score_dr", "mos_score_volte", "call_drop_dr",
        "call_drop_volte", "total_sms", "class_num", "created_at", "updated_at"],
        [(i, *m, i, now, now) for i, m in enumerate(matrix, start=1)])
    bulk_insert(con, "nba_advisory", ["id", "class_num", "suspected_root_cause", "prompt", "action", "summary",
                                      "created_at", "updated_at"],
                [(i, i, *a, now, now) for i, a in enumerate(adv, start=1)])

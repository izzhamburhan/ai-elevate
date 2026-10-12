# 1.0 Problem Statement — Elevate: Ask the Map

**Project title (suggestion):** Elevate — an AI map copilot for network operations

**In one sentence:** Network answers at TM need data from many separate systems, and only a few
skilled engineers can put that data together on a map. A simple question about a place can take
hours to answer.

> Numbers in **[brackets]** are estimates. Check them with the users before the pitch.

---

## 01 Background

- TM's network data sits in separate systems:
  - the MINDS map portal (coverage, sites, congestion)
  - BIN visualisation (RSRP/RSRQ/throughput per grid)
  - THD ticketing (NTT/CTT)
  - the NBA collector (subscriber experience)
- Most network questions are about places. For example: "Why is coverage poor in Bangsar?",
  "Which sites are hit by the flood?" or "Why does this customer's signal drop every evening?"
- To answer them, you also need outside data: rainfall, flood, power outages, crowd events, and
  critical sites such as hospitals, schools and SLA customers.
- There is no single map where all of this comes together and anyone can ask about it.

## 02 Current Process

1. The engineer logs in to each portal separately (MINDS, BIN, THD, NBA).
2. They filter each system by site, cluster or date, then export or screenshot the results.
3. Many results only have site or cell IDs, so they look up the coordinates by hand.
4. They join the data in Excel or ask a GIS/analytics team to make a map.
5. They share the result as slides or email. Every follow-up question starts again from step 1.
6. Customer care cannot see the network view. They escalate complaints to the network team, who
   repeat steps 1–5 for one subscriber.

## 03 Pain Points

- **Fragmented data:** an investigation touches **[4+]** systems, with no shared map view.
- **Slow:** each investigation takes **[1–2 hours]** of switching screens and manual joins.
- **Needs specialists:** you need GIS, SQL or portal know-how, so other teams depend on a few
  engineers.
- **Static answers:** reports are out of date once shared, and you can't ask follow-up questions.
- **Weak root cause:** network faults are not linked to weather, flood, power or events.
- **Sensitive data handled by hand:** subscriber location data (PDPA) is pulled ad hoc. There is no
  consistent masking, role control or audit trail.

## 04 Impact

- **Longer fault and complaint resolution (MTTR):** more repeat CTTs, churn risk and enterprise SLA
  penalties.
- **Wasted engineering time:** **[X hours/week]** goes into handling data instead of fixing the
  network.
- **Reactive, not proactive:** weak areas are found after customers complain. Towers at risk from
  floods or crowd events are not flagged ahead of time.
- **Mixed answers:** each team builds its own view, so leaders see different numbers for the same
  area.

## Expected Output / Outcome

- **One map workspace with an AI assistant.** Users ask in plain language, for example "Show
  congested 5G cells in Bangsar this week with open tickets". The AI pulls live data from the
  connected sources (MCP connectors) and draws the answer on the map.
- **From hours to minutes:** questions are answered in **[< 2 minutes]** instead of **[1–2 hours]**.
  Follow-up questions build on the same map.
- **Self-service for all LOBs:** network, care, enterprise and planning teams can use it with no GIS
  or SQL skills.
- **Linked root cause:** network KPIs, tickets, weather, flood, power and events appear on one view.
- **Governed by design:** personal data is masked and access depends on the user's role. Actions
  need policy approval and every lookup is logged.

---

### Slide-ready short version

| Background | Current Process | Pain Points | Impact |
|---|---|---|---|
| Network data is spread across MINDS, BIN, THD and NBA, with no single map. Most questions are about places. | 1. Log in to each portal<br>2. Export and match IDs to coordinates<br>3. Join in Excel or ask the GIS team<br>4. Share static slides | • [4+] systems per question<br>• [1–2 hrs] per investigation<br>• Needs GIS/SQL skills<br>• No link to weather, flood or power<br>• PDPA data handled by hand | • Slower MTTR, more CTTs<br>• SLA penalties, churn risk<br>• Engineer time wasted<br>• Reactive, not proactive |

**Expected outcome:** Ask the map in plain language and get the answer drawn in minutes, for every
LOB, with governance built in.

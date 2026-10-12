"""Reference data for the synthetic generator. Value domains come from the real
production fixtures and code (regions, states, statuses, formats)."""

REGIONS = ["Central", "Northern", "Southern", "Eastern", "Sabah", "Sarawak"]

# 4G Site_ID prefixes per region (2 letters + 4 digits, e.g. CB0048, BL0488)
SITE_PREFIX = {
    "Central": ["CB", "CC", "CK"],
    "Northern": ["NP", "NK", "NA"],
    "Southern": ["SJ", "SM", "SN"],
    "Eastern": ["EC", "ED", "ET"],
    "Sabah": ["BL", "BQ"],
    "Sarawak": ["BS", "QK"],
}

# (Cluster_ID, Cluster_Name, Region, State, lat, lng, Morphology, 5G district code)
CLUSTERS = [
    ("CL_KL_01", "KLCC", "Central", "WP KUALA LUMPUR", 3.1579, 101.7123, "Dense Urban", "KUL"),
    ("CL_KL_02", "Bukit Bintang", "Central", "WP KUALA LUMPUR", 3.1466, 101.7101, "Dense Urban", "KUL"),
    ("CL_KL_03", "Bangsar", "Central", "WP KUALA LUMPUR", 3.1290, 101.6790, "Urban", "KUL"),
    ("CL_KL_04", "Cheras", "Central", "WP KUALA LUMPUR", 3.0950, 101.7440, "Urban", "KUL"),
    ("CL_KL_05", "Kepong", "Central", "WP KUALA LUMPUR", 3.2140, 101.6360, "Urban", "KUL"),
    ("CL_SL_01", "Petaling Jaya", "Central", "SELANGOR", 3.1073, 101.6067, "Urban", "PTL"),
    ("CL_SL_02", "Subang Jaya", "Central", "SELANGOR", 3.0567, 101.5851, "Urban", "PTL"),
    ("CL_SL_03", "Shah Alam", "Central", "SELANGOR", 3.0733, 101.5185, "Urban", "PTL"),
    ("CL_SL_04", "Klang", "Central", "SELANGOR", 3.0449, 101.4456, "Sub Urban", "KLG"),
    ("CL_SL_05", "Puchong", "Central", "SELANGOR", 3.0250, 101.6170, "Sub Urban", "PTL"),
    ("CL_SL_06", "Cyberjaya", "Central", "SELANGOR", 2.9213, 101.6559, "Sub Urban", "SPG"),
    ("CL_PJ_01", "Putrajaya", "Central", "WP PUTRAJAYA", 2.9264, 101.6964, "Urban", "PJY"),
    ("CL_SL_07", "Kajang", "Central", "SELANGOR", 2.9935, 101.7871, "Sub Urban", "HLG"),
    ("CL_SL_08", "Rawang", "Central", "SELANGOR", 3.3213, 101.5767, "Rural", "GBK"),
    ("CL_PG_01", "George Town", "Northern", "PULAU PINANG", 5.4141, 100.3288, "Dense Urban", "TLA"),
    ("CL_PG_02", "Bayan Lepas", "Northern", "PULAU PINANG", 5.2945, 100.2593, "Urban", "BDY"),
    ("CL_PG_03", "Butterworth", "Northern", "PULAU PINANG", 5.3991, 100.3638, "Urban", "SPU"),
    ("CL_PK_01", "Ipoh", "Northern", "PERAK", 4.5975, 101.0901, "Urban", "KIN"),
    ("CL_PK_02", "Taiping", "Northern", "PERAK", 4.8500, 100.7333, "Sub Urban", "LRM"),
    ("CL_KD_01", "Alor Setar", "Northern", "KEDAH & PERLIS", 6.1248, 100.3678, "Urban", "KST"),
    ("CL_KD_02", "Sungai Petani", "Northern", "KEDAH & PERLIS", 5.6470, 100.4877, "Sub Urban", "KMD"),
    ("CL_JH_01", "Johor Bahru", "Southern", "JOHOR", 1.4927, 103.7414, "Dense Urban", "JBH"),
    ("CL_JH_02", "Iskandar Puteri", "Southern", "JOHOR", 1.4260, 103.6400, "Urban", "JBH"),
    ("CL_JH_03", "Batu Pahat", "Southern", "JOHOR", 1.8548, 102.9325, "Sub Urban", "BPH"),
    ("CL_ML_01", "Melaka Tengah", "Southern", "MELAKA", 2.1896, 102.2501, "Urban", "MTG"),
    ("CL_NS_01", "Seremban", "Southern", "NEGERI SEMBILAN", 2.7258, 101.9424, "Urban", "SRB"),
    ("CL_PH_01", "Kuantan", "Eastern", "PAHANG", 3.8077, 103.3260, "Urban", "KTN"),
    ("CL_KN_01", "Kota Bharu", "Eastern", "KELANTAN", 6.1254, 102.2381, "Urban", "KBR"),
    ("CL_TR_01", "Kuala Terengganu", "Eastern", "TERENGGANU", 5.3302, 103.1408, "Urban", "KTR"),
    ("CL_PH_02", "Temerloh", "Eastern", "PAHANG", 3.4500, 102.4170, "Rural", "TML"),
    ("CL_SB_01", "Kota Kinabalu", "Sabah", "SABAH", 5.9804, 116.0735, "Urban", "KKI"),
    ("CL_SB_02", "Sandakan", "Sabah", "SABAH", 5.8402, 118.1179, "Sub Urban", "SDK"),
    ("CL_SB_03", "Tawau", "Sabah", "SABAH", 4.2448, 117.8912, "Sub Urban", "TWU"),
    ("CL_LB_01", "Labuan", "Sabah", "WP LABUAN", 5.2831, 115.2308, "Sub Urban", "LBN"),
    ("CL_SW_01", "Kuching", "Sarawak", "SARAWAK", 1.5533, 110.3592, "Urban", "KCH"),
    ("CL_SW_02", "Miri", "Sarawak", "SARAWAK", 4.3995, 113.9914, "Urban", "MRI"),
    ("CL_SW_03", "Sibu", "Sarawak", "SARAWAK", 2.2870, 111.8305, "Sub Urban", "SBU"),
    ("CL_SW_04", "Bintulu", "Sarawak", "SARAWAK", 3.1700, 113.0300, "Sub Urban", "BTU"),
    # wider footprint: more of the Klang Valley plus secondary towns in every state
    ("CL_KL_06", "Mont Kiara", "Central", "WP KUALA LUMPUR", 3.1700, 101.6500, "Dense Urban", "KUL"),
    ("CL_KL_07", "Setapak", "Central", "WP KUALA LUMPUR", 3.1980, 101.7180, "Urban", "KUL"),
    ("CL_KL_08", "Bukit Jalil", "Central", "WP KUALA LUMPUR", 3.0580, 101.6900, "Urban", "KUL"),
    ("CL_KL_09", "Wangsa Maju", "Central", "WP KUALA LUMPUR", 3.2050, 101.7350, "Urban", "KUL"),
    ("CL_SL_09", "Ampang", "Central", "SELANGOR", 3.1500, 101.7600, "Urban", "HLG"),
    ("CL_SL_10", "Kota Damansara", "Central", "SELANGOR", 3.1550, 101.5850, "Urban", "PTL"),
    ("CL_SL_11", "Selayang", "Central", "SELANGOR", 3.2600, 101.6550, "Urban", "GBK"),
    ("CL_SL_12", "Semenyih", "Central", "SELANGOR", 2.9500, 101.8430, "Sub Urban", "HLG"),
    ("CL_SL_13", "Sepang", "Central", "SELANGOR", 2.7456, 101.7072, "Rural", "SPG"),
    ("CL_SL_14", "Kuala Selangor", "Central", "SELANGOR", 3.3400, 101.2500, "Rural", "KSL"),
    ("CL_PG_04", "Bukit Mertajam", "Northern", "PULAU PINANG", 5.3630, 100.4610, "Sub Urban", "SPT"),
    ("CL_PK_03", "Teluk Intan", "Northern", "PERAK", 4.0250, 101.0210, "Sub Urban", "HPR"),
    ("CL_PK_04", "Manjung", "Northern", "PERAK", 4.2167, 100.7000, "Sub Urban", "MNJ"),
    ("CL_PL_01", "Kangar", "Northern", "KEDAH & PERLIS", 6.4414, 100.1986, "Sub Urban", "KGR"),
    ("CL_KD_03", "Langkawi", "Northern", "KEDAH & PERLIS", 6.3200, 99.8500, "Rural", "LGK"),
    ("CL_KD_04", "Kulim", "Northern", "KEDAH & PERLIS", 5.3650, 100.5620, "Sub Urban", "KLM"),
    ("CL_JH_04", "Muar", "Southern", "JOHOR", 2.0442, 102.5689, "Sub Urban", "MUR"),
    ("CL_JH_05", "Kluang", "Southern", "JOHOR", 2.0305, 103.3185, "Sub Urban", "KLU"),
    ("CL_JH_06", "Pasir Gudang", "Southern", "JOHOR", 1.4700, 103.9000, "Urban", "JBH"),
    ("CL_ML_02", "Alor Gajah", "Southern", "MELAKA", 2.3804, 102.2089, "Rural", "AGJ"),
    ("CL_NS_02", "Nilai", "Southern", "NEGERI SEMBILAN", 2.8150, 101.8000, "Sub Urban", "SRB"),
    ("CL_NS_03", "Port Dickson", "Southern", "NEGERI SEMBILAN", 2.5228, 101.7960, "Rural", "PDS"),
    ("CL_PH_03", "Bentong", "Eastern", "PAHANG", 3.5226, 101.9087, "Rural", "BTG"),
    ("CL_PH_04", "Cameron Highlands", "Eastern", "PAHANG", 4.4700, 101.3770, "Rural", "CHL"),
    ("CL_TR_02", "Kemaman", "Eastern", "TERENGGANU", 4.2333, 103.4167, "Sub Urban", "KMN"),
    # Kelantan stays far from Kuala Krai: the scripted flood cluster anchors on the nearest cluster (Kota Bharu)
    ("CL_KN_02", "Gua Musang", "Eastern", "KELANTAN", 4.8823, 101.9644, "Rural", "GMS"),
    ("CL_SB_04", "Lahad Datu", "Sabah", "SABAH", 5.0268, 118.3270, "Sub Urban", "LDU"),
    ("CL_SB_05", "Keningau", "Sabah", "SABAH", 5.3378, 116.1602, "Rural", "KNG"),
    ("CL_SW_05", "Samarahan", "Sarawak", "SARAWAK", 1.4600, 110.4900, "Sub Urban", "KCH"),
    ("CL_SW_06", "Sri Aman", "Sarawak", "SARAWAK", 1.2370, 111.4620, "Rural", "SAM"),
]

# Sites per cluster and spread (km) by morphology
MORPH_SITES = {"Dense Urban": 26, "Urban": 19, "Sub Urban": 12, "Rural": 8}
MORPH_SPREAD_KM = {"Dense Urban": 1.3, "Urban": 2.0, "Sub Urban": 3.0, "Rural": 4.5}
MORPH_RADIUS_KM = {"Dense Urban": 0.55, "Urban": 0.9, "Sub Urban": 1.5, "Rural": 2.6}

VENDORS_4G = ["Huawei", "ZTE"]
OPERATORS = {"Unifi": 0.0, "Maxis": 2.0, "Celcom": 1.0, "Digi": 0.0, "U Mobile": -2.0, "Yes": -5.0}

FREQ_BANDS = {
    # rollout token -> (Freq_Band, cell suffix digit, Bandwidth MHz, propagation offset dB)
    "FDD850": ("FDD-LTE850", 1, 10, 3.0),
    "TDD2300": ("TDD-LTE2300", 2, 20, -2.0),
    "TDD2600": ("TDD-LTE2600", 3, 20, -4.0),
}

STREETS = [
    "Jalan Ampang", "Jalan Tun Razak", "Jalan Sultan Ismail", "Jalan Klang Lama", "Persiaran Kewajipan",
    "Jalan Templer", "Jalan Kuching", "Jalan Ipoh", "Jalan Pahang", "Lebuhraya Persekutuan",
    "Jalan Bukit Bintang", "Jalan Cheras", "Jalan Kepong", "Jalan Gasing", "Jalan SS2",
    "Jalan Sultan Ibrahim", "Jalan Tun Abdul Razak", "Jalan Masjid", "Jalan Pantai", "Jalan Merdeka",
]

POI_CATEGORIES = ["TM", "Government", "Higher Education", "School", "Industry", "Shopping",
                  "Transport", "Accommodation", "Residential"]
ACTIVE_POI = POI_CATEGORIES[:-1]
POI_NAMES = {
    "TM": ["TM Point", "TM Exchange", "Unifi Store"],
    "Government": ["Pejabat Daerah", "Balai Polis", "Majlis Bandaraya", "Klinik Kesihatan"],
    "Higher Education": ["Kolej Komuniti", "Universiti Teknologi", "Politeknik"],
    "School": ["SK Taman", "SMK Seri", "SJK(C) Chung Hwa"],
    "Industry": ["Kawasan Perindustrian", "Gudang Logistik", "Kilang Elektronik"],
    "Shopping": ["Pasar Raya", "Mall", "Kedai Runcit", "AEON"],
    "Transport": ["Stesen LRT", "Stesen Bas", "Hentian Teksi", "Stesen KTM"],
    "Accommodation": ["Hotel", "Homestay", "Budget Inn"],
    "Residential": ["Taman", "Pangsapuri", "Kondominium", "Flat"],
}
PROPERTY_TYPES = ["Terrace", "Condominium", "Apartment", "Semi-D", "Bungalow", "Shop Lot", "Office"]

# NTT (ntt_granite)
NTT_FAULTS = [("Total Outage", 0.33), ("Partial Outage", 0.37), ("Degradation", 0.2), ("No Impact", 0.1)]
NTT_SYMPTOMS = ["LTE - Power Issue", "LTE - 4G Service Down", "LTE - eNodeB Isolate",
                "LTE - Others", "LTE - Packet Loss"]
NTT_PROBLEMS = {
    "LTE - Power Issue": "Commercial power failure at site, running on battery backup.",
    "LTE - 4G Service Down": "All LTE cells down at site, S1 link lost.",
    "LTE - eNodeB Isolate": "eNodeB isolated from OSS, transmission link down.",
    "LTE - Others": "Intermittent alarms reported on BBU.",
    "LTE - Packet Loss": "High packet loss on backhaul, user throughput degraded.",
}
NTT_CLOSED_STATUSES = ["Closed", "Network Resolved", "Cancel"]

# Ntt5G
NTT5G_OPEN = ["Assigned", "Pending", "In Progress"]
NTT5G_CLOSED = ["Resolved", "Closed", "Cancelled"]

# Plan maintenance
PM_STATUS = [("CLOSE", 0.45), ("WIMPLEMENTER", 0.2), ("WCAB", 0.1), ("CABREJECT", 0.06),
             ("ReqCancel", 0.06), ("IMPLEMENTERCANCELLED", 0.07), ("CCREJECT", 0.06)]
PM_RFC_TYPE = ["NORMAL", "STANDARD", "URGENT", "EMERGENCY", "PRE APPROVE"]
PM_REASON = ["Project", "Customer Request", "Problem Management", "Maintenance", "Migration",
             "Incident Management", "Provisioning", "Decommission"]
PM_SUBNET = ["RAN-Power cabinet and PDU - Base Station", "OPTI-Parameter",
             "RAN-ENodeB hardware - EnodeB", "RAN-Antenna and RRU", "TX-Microwave link"]
PM_CORE_SUBNET = ["VOICE-IMS", "IP CORE-Firewall", "PS CORE-PGW"]
PM_DIVISION = ["Technology", "WBE", "Service Operation", "Network Deployment",
               "Radio Network Capacity Planning"]
PM_TITLES = {
    "RAN-Power cabinet and PDU - Base Station": "Rectifier module replacement",
    "OPTI-Parameter": "Parameter optimisation for coverage tuning",
    "RAN-ENodeB hardware - EnodeB": "BBU board swap",
    "RAN-Antenna and RRU": "RRU replacement and antenna re-tilt",
    "TX-Microwave link": "Microwave link capacity upgrade",
    "VOICE-IMS": "IMS software patch",
    "IP CORE-Firewall": "Firewall policy update",
    "PS CORE-PGW": "PGW capacity expansion",
}
CORE_HOSTS = ["BRF PGW", "KVL-MME-01", "CBJ-IMS-02", "JHR-SGW-01", "PNG-FW-03"]

PERSON_NAMES = [
    "Ahmad Faizal", "Nur Aisyah", "Lim Wei Jie", "Tan Mei Ling", "Muhammad Hakim", "Siti Nurhaliza",
    "Rajesh Kumar", "Priya Devi", "Wong Kar Wai", "Farah Nabila", "Hafiz Rahman", "Chong Li Ying",
    "Aiman Danial", "Nurul Izzah", "Kumar Selvam", "Ong Boon Hock", "Zulkifli Hassan", "Amirah Sofea",
    "Daniel Lee", "Kavitha Raj", "Syafiq Iskandar", "Lee Chong Wei", "Melissa Tan", "Hidayah Azman",
]

# CTT (THD)
CTT_CASE_TYPES = [("Coverage", 0.35), ("Data", 0.3), ("Voice", 0.15), ("Congestion", 0.2)]
CTT_ROOT_CAUSES = ["Coverage", "Congestion", "Outage", "Device", "Indoor coverage", "Others"]
REGION_WEIGHTS = {"Central": 0.4, "Northern": 0.18, "Southern": 0.15, "Eastern": 0.09,
                  "Sabah": 0.09, "Sarawak": 0.09}

# Subscribers
PLANS_POSTPAID = ["UNI5G Postpaid 99", "UNI5G Postpaid 69", "Unifi Mobile Postpaid 39", "Unifi Mobile Family 129"]
PLANS_PREPAID = ["UNI5G Prepaid 35", "Unifi Mobile Prepaid 30", "Unifi Mobile Prepaid 20"]
DEVICES = [
    ("Apple", "iPhone 15 Pro (A3102)", "Smartphone", "iOS 18.5", True),
    ("Apple", "iPhone 13 (A2633)", "Smartphone", "iOS 17.6", True),
    ("Apple", "iPhone 11 Pro Max (A2218)", "Smartphone", "iOS 16.6", False),
    ("Samsung", "Galaxy S24 Ultra (SM-S928B)", "Smartphone", "Android 15", True),
    ("Samsung", "Galaxy A55 5G (SM-A556E)", "Smartphone", "Android 14", True),
    ("Samsung", "Galaxy A14 (SM-A145F)", "Smartphone", "Android 13", False),
    ("Xiaomi", "Redmi Note 13 5G", "Smartphone", "Android 14", True),
    ("Xiaomi", "Redmi 12C", "Smartphone", "Android 13", False),
    ("Oppo", "Reno 11 5G", "Smartphone", "Android 14", True),
    ("Vivo", "V30 5G", "Smartphone", "Android 14", True),
    ("Huawei", "Nova 11i", "Smartphone", "EMUI 13", False),
    ("Honor", "X9b 5G", "Smartphone", "Android 13", True),
    ("realme", "C55", "Smartphone", "Android 13", False),
    ("Apple", "iPad Air (A2589)", "Tablet", "iPadOS 17.5", True),
    ("Nokia", "3310 4G", "Feature Phone", "S30+", False),
]
APPS = ["YouTube", "TikTok", "WhatsApp", "Facebook", "Instagram", "Netflix", "Google", "Shopee",
        "Spotify", "Telegram", "Grab", "Waze"]
APP_WEIGHT = [0.22, 0.18, 0.08, 0.1, 0.1, 0.12, 0.05, 0.04, 0.04, 0.02, 0.03, 0.02]

PERSONAS = [
    ("normal", 0.5),
    ("poor_coverage_home", 0.1),
    ("congestion_work", 0.08),
    ("outage_affected", 0.06),
    ("quota_exhausted", 0.06),
    ("heavy_user", 0.08),
    ("volte_issue", 0.06),
    ("barred", 0.03),
    ("rural_mocn", 0.03),
]

# VIP ticketing
TICKET_GROUPS = [
    (1, "NQO", "nqo@example.com"),
    (2, "Planner", "planner@example.com"),
    (3, "Rollout", "rollout@example.com"),
    (4, "IMS Core", "imscore@example.com"),
    (5, "PS Core", "pscore@example.com"),
    (6, "SOC", "soc@example.com"),
    (7, "Celcom", "celcom.partner@example.com"),
    (8, "DNB", "dnb.partner@example.com"),
    (9, "PSC", "psc@example.com"),
]
TT_STATUS = [("Closed", 0.5), ("Completed PSC", 0.15), ("In Progress", 0.2), ("Open", 0.15)]
VIP_PROBLEMS = [
    ("No coverage indoor", "Coverage", "Indoor coverage"),
    ("Weak signal outdoor", "Coverage", "Outdoor coverage gap"),
    ("Slow internet", "Congestion", "Cell congestion"),
    ("Call drop", "Network", "Handover failure"),
    ("Unable to make call", "Network", "VoLTE provisioning"),
    ("Intermittent data", "Network", "Site outage"),
    ("No service", "Network", "Site outage"),
    ("Slow internet", "Device", "Device setting"),
]
PSC_PICS = ["Ahmad Faizal", "Nur Aisyah", "Lim Wei Jie", "NOC Support", "Tan Mei Ling", "Hafiz Rahman"]

-- Synthetic network-operations DuckDB schema.
--
-- Table and column names mirror the production source systems so queries
-- port across with minimal change. MongoDB collections (coverage, BIN polygons,
-- HWC clover, TM cluster) become tables whose `geometry` column holds GeoJSON
-- text plus a bounding box for cheap spatial pre-filtering. Tables marked
-- "(synthetic)" have no real counterpart and were designed for this server.

-- ---------------------------------------------------------------------------
-- Meta / helpers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _meta (
    key   VARCHAR PRIMARY KEY,
    value VARCHAR
);

CREATE OR REPLACE MACRO haversine_km(lat1, lng1, lat2, lng2) AS
    6371.0 * 2 * asin(sqrt(
        pow(sin(radians(lat2 - lat1) / 2), 2) +
        cos(radians(lat1)) * cos(radians(lat2)) * pow(sin(radians(lng2 - lng1) / 2), 2)
    ));

-- ---------------------------------------------------------------------------
-- Site inventory (map API / BIN visualisation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Site4G (
    Site_ID        VARCHAR(50) PRIMARY KEY,
    Site_Name      VARCHAR,
    TDD_Site_ID    VARCHAR,
    Vendor         VARCHAR,
    Type           VARCHAR,
    Type_Map       VARCHAR,
    Rollout        VARCHAR,
    Region         VARCHAR,
    State          VARCHAR,
    Mukim_Area     VARCHAR,
    Cluster_ID     VARCHAR,
    Cluster_Name   VARCHAR,
    Power          VARCHAR,
    Backhaul       VARCHAR,
    eNodeB_ID      BIGINT,
    TAC            VARCHAR,
    TAL            VARCHAR,
    RFP_Morphology VARCHAR,
    Latitude       DOUBLE,
    Longitude      DOUBLE,
    Address        VARCHAR,
    Status         VARCHAR,
    Owner          VARCHAR,
    ZBC_Border     VARCHAR,
    TM_Exchange    VARCHAR,
    Exchange_ABB   VARCHAR
);

CREATE TABLE IF NOT EXISTS Cell4G (
    Cell_Name       VARCHAR(150) PRIMARY KEY,
    Cell_ID         BIGINT,
    Site_ID         VARCHAR(50),
    ECI             DOUBLE,
    Freq_Band       VARCHAR,
    Antenna_Model   VARCHAR,
    RRU             VARCHAR,
    Azimuth         DOUBLE,
    Antenna_Height  VARCHAR,
    E_Tilt          VARCHAR,
    M_Tilt          VARCHAR,
    PCI             DOUBLE,
    RS_Power        DOUBLE,
    Date_Status_RFS VARCHAR,
    Radius          DOUBLE,
    Bandwidth       BIGINT,
    Sector_ID       DOUBLE,
    Site_Cell_ID    VARCHAR(150)
);

CREATE TABLE IF NOT EXISTS Site5G (
    Site_ID    VARCHAR(50) PRIMARY KEY,
    Site_Name  VARCHAR,
    Type       VARCHAR,
    Type_Map   VARCHAR,
    Region     VARCHAR,          -- added: real table has no region; needed for region filters
    State      VARCHAR,
    District   VARCHAR,
    Cluster_ID VARCHAR,
    gNodeB_ID  DOUBLE,
    eNodeB_ID  DOUBLE,
    TAC        BIGINT,
    Latitude   DOUBLE,
    Longitude  DOUBLE,
    Address    VARCHAR,
    Status     VARCHAR
);

CREATE TABLE IF NOT EXISTS Cell5G (
    Site_ID      VARCHAR,
    Cell_Name    VARCHAR(80),
    Cell_ID      DOUBLE,
    Site_Cell_ID VARCHAR(100) PRIMARY KEY,
    PCI          DOUBLE,
    DL_BW        VARCHAR,
    DL_EARFCN    BIGINT,
    nCGI         VARCHAR,
    Azimuth      VARCHAR,
    Height       VARCHAR
);

CREATE TABLE IF NOT EXISTS SiteMOCN (
    Site_ID      VARCHAR(50) PRIMARY KEY,
    Phase        VARCHAR(35),
    Vendor       VARCHAR(15),
    Type         VARCHAR(15),
    Type_Map     VARCHAR(15),
    Region       VARCHAR(25),     -- UPPERCASE in the real data
    State        VARCHAR(25),
    Cluster      VARCHAR(35),
    TAC          DOUBLE,
    eNobeB_Name  VARCHAR(70),     -- typo preserved from the real schema
    Latitude     DOUBLE,
    Longitude    DOUBLE,
    Address      VARCHAR
);

-- eNodeB -> MOCN site lookup (nba-collector site4gMOCN_model)
CREATE TABLE IF NOT EXISTS Site4GMOCN (
    SITE_ID   VARCHAR(50) PRIMARY KEY,
    ENODEB_ID BIGINT,
    Latitude  DOUBLE,
    Longitude DOUBLE
);

CREATE TABLE IF NOT EXISTS CellMOCN (
    Cell_Name VARCHAR(50) PRIMARY KEY,
    Cell_ID   VARCHAR(15),
    Site_ID   VARCHAR(50),
    ECI       INTEGER,
    DL_EARFCN INTEGER,
    Azimuth   INTEGER,
    PCI       INTEGER
);

CREATE TABLE IF NOT EXISTS Site3G (
    Site_ID   VARCHAR(50) PRIMARY KEY,
    Sitename  VARCHAR,
    Type      VARCHAR,
    Type_Map  VARCHAR,
    Region    VARCHAR,
    State     VARCHAR,
    Vendor    VARCHAR,
    LAC       VARCHAR,
    SAC       VARCHAR,
    Latitude  DOUBLE,
    Longitude DOUBLE,
    Address   VARCHAR
);

CREATE TABLE IF NOT EXISTS Cell3G (
    Cell_ID        BIGINT,
    Site_ID        VARCHAR,
    Site_Cell_ID   VARCHAR(100) PRIMARY KEY,
    Azimuth        DOUBLE,
    Antenna_Height DOUBLE,
    Freq_Band      VARCHAR,
    DL_UARFCN      BIGINT
);

CREATE TABLE IF NOT EXISTS Site2G (
    Site_ID      VARCHAR(50),
    Sitename     VARCHAR,
    Site_ID_Type VARCHAR(50) PRIMARY KEY,
    Type         VARCHAR,
    Type_Map     VARCHAR,
    Region       VARCHAR,
    State        VARCHAR,
    Vendor       VARCHAR,
    BSIC         VARCHAR,
    Latitude     DOUBLE,
    Longitude    DOUBLE,
    Address      VARCHAR
);

CREATE TABLE IF NOT EXISTS Cell2G (
    Traffic_Cell_Name VARCHAR(50),
    Site_ID           VARCHAR,
    Site_Cell_ID      VARCHAR(100) PRIMARY KEY,
    Azimuth           DOUBLE,
    Antenna_Height    DOUBLE,
    LAC               BIGINT,
    BCCH              DOUBLE,
    Freq_Band         VARCHAR,
    NCC               VARCHAR,
    BCC               DOUBLE
);

CREATE TABLE IF NOT EXISTS SiteAOP (
    id              BIGINT PRIMARY KEY,
    site_id         VARCHAR(100),
    new_aop         VARCHAR(100),
    pmo_summary     VARCHAR(100),
    site_name       VARCHAR(100),
    region          VARCHAR(30),  -- added for region filters
    longitude       DOUBLE,
    latitude        DOUBLE,
    status          VARCHAR(100),
    fdd850_rfs_date DATE,
    tdd_rfs_date    DATE,
    rfs_baseline    DATE,
    target_quarter  VARCHAR(100),
    type_map        VARCHAR(50)
);

-- ---------------------------------------------------------------------------
-- Map layers (MongoDB collections in the real system)
-- ---------------------------------------------------------------------------
-- One table for Coverage_FDD / Coverage_TDD / Coverage_5G / Coverage_MOCN /
-- HWC / Congestion_FDD / Congestion_TDD; `collection` holds the original name.
CREATE TABLE IF NOT EXISTS coverage_layers (
    id         BIGINT PRIMARY KEY,
    collection VARCHAR,
    Week       INTEGER,
    Year       INTEGER,
    site_id    VARCHAR,
    Name       VARCHAR,           -- HWC only
    Action     VARCHAR,           -- HWC only
    Target     VARCHAR,           -- HWC only
    geometry   VARCHAR,           -- GeoJSON Polygon
    min_lat DOUBLE, max_lat DOUBLE, min_lng DOUBLE, max_lng DOUBLE
);

CREATE TABLE IF NOT EXISTS Bin_Information (
    Grid_ID  INTEGER PRIMARY KEY,
    State    VARCHAR(20),
    Cluster_ID VARCHAR,           -- added: TM cluster containing the bin centroid
    latitude  DOUBLE,             -- centroid
    longitude DOUBLE,
    geometry  VARCHAR,            -- GeoJSON Polygon
    min_lat DOUBLE, max_lat DOUBLE, min_lng DOUBLE, max_lng DOUBLE
);

CREATE TABLE IF NOT EXISTS HWC_Status (
    Cell_Name  VARCHAR PRIMARY KEY,
    HWC_Status VARCHAR,           -- Hot | Warm | Cold
    Week       INTEGER,
    Year       INTEGER,
    geometry   VARCHAR,           -- clover wedge polygon
    min_lat DOUBLE, max_lat DOUBLE, min_lng DOUBLE, max_lng DOUBLE
);

CREATE TABLE IF NOT EXISTS TM_Cluster (
    Cluster_ID   VARCHAR PRIMARY KEY,
    Cluster_Name VARCHAR,
    Morphology   VARCHAR,
    Region       VARCHAR,
    State        VARCHAR,
    latitude     DOUBLE,
    longitude    DOUBLE,
    geometry     VARCHAR,
    min_lat DOUBLE, max_lat DOUBLE, min_lng DOUBLE, max_lng DOUBLE
);

-- ---------------------------------------------------------------------------
-- BIN KPI (bin_visualisation). One table per observation duration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bin_bgs_weekly (
    row_id INTEGER, year INTEGER, weekly_id INTEGER, year_weekly_id VARCHAR,
    grid_id INTEGER, operator VARCHAR,
    rsrp_max DOUBLE, rsrp_min DOUBLE, rsrp_sum DOUBLE, rsrp_count BIGINT, rsrp_avg DOUBLE,
    rsrq_max DOUBLE, rsrq_min DOUBLE, rsrq_sum DOUBLE, rsrq_count BIGINT, rsrq_avg DOUBLE,
    execution_date TIMESTAMP
);
CREATE TABLE IF NOT EXISTS bin_bgs_monthly     AS SELECT * EXCLUDE (weekly_id, year_weekly_id) FROM bin_bgs_weekly WHERE false;
CREATE TABLE IF NOT EXISTS bin_bgs_bi_monthly  AS SELECT * FROM bin_bgs_monthly WHERE false;
CREATE TABLE IF NOT EXISTS bin_bgs_quarterly   AS SELECT * FROM bin_bgs_monthly WHERE false;
CREATE TABLE IF NOT EXISTS bin_bgs_half_yearly AS SELECT * FROM bin_bgs_monthly WHERE false;
CREATE TABLE IF NOT EXISTS bin_bgs_yearly      AS SELECT * FROM bin_bgs_monthly WHERE false;

CREATE TABLE IF NOT EXISTS bin_ci_weekly (
    row_id INTEGER, year INTEGER, weekly_id INTEGER, year_weekly_id VARCHAR,
    grid_id INTEGER, operator VARCHAR,
    sum_download_mbps DOUBLE, sample_download BIGINT,
    min_download_mbps DOUBLE, max_download_mbps DOUBLE, avg_download_mbps DOUBLE,
    sum_upload_mbps DOUBLE, sample_upload BIGINT,
    min_upload_mbps DOUBLE, max_upload_mbps DOUBLE, avg_upload_mbps DOUBLE,
    sum_latency BIGINT, sample_latency BIGINT, min_latency BIGINT, max_latency BIGINT, avg_latency BIGINT,
    execution_date TIMESTAMP
);
CREATE TABLE IF NOT EXISTS bin_ci_monthly     AS SELECT * EXCLUDE (weekly_id, year_weekly_id) FROM bin_ci_weekly WHERE false;
CREATE TABLE IF NOT EXISTS bin_ci_bi_monthly  AS SELECT * FROM bin_ci_monthly WHERE false;
CREATE TABLE IF NOT EXISTS bin_ci_quarterly   AS SELECT * FROM bin_ci_monthly WHERE false;
CREATE TABLE IF NOT EXISTS bin_ci_half_yearly AS SELECT * FROM bin_ci_monthly WHERE false;
CREATE TABLE IF NOT EXISTS bin_ci_yearly      AS SELECT * FROM bin_ci_monthly WHERE false;

CREATE TABLE IF NOT EXISTS Bin_BGS_Top_Cell_Weekly (
    id INTEGER, year INTEGER, weekly_id INTEGER, grid_id INTEGER,
    Site_ID VARCHAR, site_cell_id VARCHAR, Vendor VARCHAR, lte_enodeb INTEGER,
    Cell_Name VARCHAR, cell_id VARCHAR, cell_rank_in_grid_id INTEGER,
    rsrp_mean_db DOUBLE, rsrp_max_db DOUBLE, rsrp_min_db DOUBLE, rsrp_sum_db DOUBLE, rsrp_count BIGINT,
    rsrq_mean_db DOUBLE, rsrq_max_db DOUBLE, rsrq_min_db DOUBLE, rsrq_sum_db DOUBLE, rsrq_count BIGINT
);
CREATE TABLE IF NOT EXISTS Bin_BGS_Top_Cell_Monthly     AS SELECT * EXCLUDE (weekly_id) FROM Bin_BGS_Top_Cell_Weekly WHERE false;
CREATE TABLE IF NOT EXISTS Bin_BGS_Top_Cell_Bi_Monthly  AS SELECT * FROM Bin_BGS_Top_Cell_Monthly WHERE false;
CREATE TABLE IF NOT EXISTS Bin_BGS_Top_Cell_Quarterly   AS SELECT * FROM Bin_BGS_Top_Cell_Monthly WHERE false;
CREATE TABLE IF NOT EXISTS Bin_BGS_Top_Cell_Half_Yearly AS SELECT * FROM Bin_BGS_Top_Cell_Monthly WHERE false;
CREATE TABLE IF NOT EXISTS Bin_BGS_Top_Cell_Yearly      AS SELECT * FROM Bin_BGS_Top_Cell_Monthly WHERE false;

-- Weekly per-cell EMS performance; one table per vendor, same columns.
CREATE TABLE IF NOT EXISTS HUAWEI_EMS (
    id INTEGER, cell_name VARCHAR, Site_ID VARCHAR, Cell_ID VARCHAR(50),
    Week_No INTEGER, Year INTEGER,
    DL_Traffic_GB DOUBLE, UL_Traffic_GB DOUBLE,
    DL_PRB_Utilization DOUBLE, UL_PRB_Utilization DOUBLE,
    Avg_DL_Throughput DOUBLE, Avg_UL_Throughput DOUBLE,
    Active_User DOUBLE, CQI DOUBLE,
    DL_Traffic_Vol_QCI6_GB DOUBLE, DL_Traffic_Vol_QCI9_GB DOUBLE,
    Active_User_QCI6 DOUBLE, Active_User_QCI9 DOUBLE,
    DL_PRB_Utilization_QCI6 DOUBLE, DL_PRB_Utilization_QCI9 DOUBLE,
    Congestion_Status VARCHAR,     -- 'Congestion' | 'Congestion2' | ''
    Less_Than_1KM DOUBLE, More_Than_1KM DOUBLE,
    TA_Group VARCHAR(50), Distance VARCHAR(50)
);
CREATE TABLE IF NOT EXISTS ZTE_EMS AS SELECT * FROM HUAWEI_EMS WHERE false;

CREATE TABLE IF NOT EXISTS History_Performance_Handover_4G (
    id INTEGER PRIMARY KEY,
    local_cell_name VARCHAR(100), local_site_id VARCHAR(100), local_cell_id VARCHAR(100),
    target_cell_name VARCHAR(100), target_site_id VARCHAR(100), target_cell_id VARCHAR(100),
    handover_success INTEGER,
    local_site_id_cell_id VARCHAR(100), target_site_id_cell_id VARCHAR(100),
    handover_success_rank DOUBLE, azimuth DOUBLE, sector_id DOUBLE, vendor VARCHAR(100),
    target_site_longitude DOUBLE, target_site_latitude DOUBLE
);

-- (synthetic) Points of interest / properties. Real data comes from the
-- external Smart Map API, which only returns counts.
CREATE TABLE IF NOT EXISTS bin_places (
    id INTEGER PRIMARY KEY,
    grid_id INTEGER,
    place_type VARCHAR,           -- poi | property
    category VARCHAR,             -- POI category or property type
    name VARCHAR,
    latitude DOUBLE,
    longitude DOUBLE
);

-- ---------------------------------------------------------------------------
-- Operations: NTT, maintenance, congestion, dashboards
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ntt_granite (
    id INTEGER PRIMARY KEY,
    mid VARCHAR(40),
    business_event VARCHAR(50),
    ntt_no VARCHAR(20),
    created_date TIMESTAMP,
    network_element_ne_id VARCHAR(255),
    network_element_type VARCHAR(255),
    network_element_brand VARCHAR(255),
    network_element_port VARCHAR(255),
    region VARCHAR(255),
    ptt VARCHAR(255),
    building VARCHAR(255),
    fault_category VARCHAR(255),
    service_impacted VARCHAR(255),
    possible_symptoms VARCHAR(255),
    resp_unit VARCHAR(255),
    ettr TIMESTAMP,
    ettr_counter INTEGER,
    problem_desc VARCHAR,
    major_breakdown VARCHAR(10),
    faulty_severity VARCHAR(25),
    status VARCHAR(50),
    network_element_card_id VARCHAR(255),
    network_element_card VARCHAR(255),
    network_element_port_id VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS ntt_5g_ntt5g (
    id INTEGER PRIMARY KEY,
    source_initiator VARCHAR(10),
    destination VARCHAR(15),
    dnb_incident_id VARCHAR(20),
    tm_incident_id VARCHAR(20),
    esb_id VARCHAR(50),
    summary VARCHAR,
    incident_description VARCHAR(255),
    node_ci VARCHAR(500),
    hpd_ci VARCHAR(500),
    incident_type VARCHAR(30),
    incident_impact VARCHAR(25),
    incident_urgency VARCHAR(10),
    incident_priority VARCHAR(10),
    incident_status VARCHAR(15),
    assigned_group VARCHAR(25),
    incident_categorization_tier1 VARCHAR,
    incident_categorization_tier2 VARCHAR,
    incident_categorization_tier3 VARCHAR,
    resolution_category_tier1 VARCHAR,
    resolution_category_tier2 VARCHAR,
    resolution_category_tier3 VARCHAR,
    resolution_note VARCHAR(500),
    region VARCHAR(50),
    transaction_type VARCHAR(10),
    event_start_time TIMESTAMP,
    event_end_time TIMESTAMP,
    submit_date TIMESTAMP,
    last_modified_date TIMESTAMP,
    last_resolved_date TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Webe_Plan_Maintenance (
    "RFC ID"             VARCHAR(50) PRIMARY KEY,
    Creation_Date        TIMESTAMP,
    Week                 INTEGER,
    Status               VARCHAR,
    Title                VARCHAR,
    "Planned Start"      TIMESTAMP,
    "Planned End"        TIMESTAMP,
    "Requester Name"     VARCHAR,
    "Requestor Division" VARCHAR,
    "RFC Type"           VARCHAR,
    Reason               VARCHAR,
    "NCA/CA"             VARCHAR,
    "Sub Network"        VARCHAR,
    Region               VARCHAR,
    Hostname             VARCHAR
);

CREATE TABLE IF NOT EXISTS Webe_Congested_Cell (
    id                            INTEGER PRIMARY KEY,
    "Created On"                  TIMESTAMP,
    Site_Cell_ID                  VARCHAR,
    "Cell ID"                     VARCHAR,
    "Site ID"                     VARCHAR(200),
    Rollout_Technology            VARCHAR,
    "Site Name_Cell"              VARCHAR,
    "Site Name"                   VARCHAR,
    Region                        VARCHAR,
    State                         VARCHAR,
    Vendor                        VARCHAR,
    Technology                    VARCHAR,
    "DL PRB"                      DOUBLE,
    "DL User Average Throughput"  DOUBLE,
    "User Average Throughput"     VARCHAR,
    "UL User Average Throughput"  DOUBLE,
    "Active Users"                DOUBLE,
    "Max RRC Users"               DOUBLE,
    Remark                        VARCHAR,
    "Action Plan"                 VARCHAR,
    PIC                           VARCHAR,
    Status                        VARCHAR,
    "Cell Utilization 1Mbps"      DOUBLE,
    "Cell Utilization 2Mbps"      DOUBLE,
    "Cell Utilization 3Mbps"      DOUBLE,
    "LessThan 1Km"                DOUBLE,
    "MoreThan 1Km"                DOUBLE,
    "TA group"                    VARCHAR,
    Distance                      VARCHAR,
    Week                          BIGINT,
    report_year                   BIGINT,
    -- (synthetic) 5G / MOCN rows share this table; real system splits them
    network                       VARCHAR      -- 4G | 4G_MOCN | 5G
);

CREATE TABLE IF NOT EXISTS Coverage_Boxes (
    id INTEGER PRIMARY KEY,
    webe_pop_coverage DECIMAL(4,1),
    webe_pop_coverage_with_mocn DECIMAL(4,1),
    availability_4g DECIMAL(4,1),
    coverage_5g DECIMAL(4,1),
    industry_webe_coverage_mocn DECIMAL(4,1),
    industry_availability_4g DECIMAL(4,1),
    total_site_rfs_4g_mocn INTEGER,
    total_site_rfs_unifi_mobile INTEGER,
    total_site_rfs_5g_dnb INTEGER
);

-- Customer trouble tickets (thd_reporting)
CREATE TABLE IF NOT EXISTS THD (
    ThdID INTEGER PRIMARY KEY,
    CreatedOn TIMESTAMP,
    Week INTEGER,
    Month INTEGER,
    Year VARCHAR(5),
    Region VARCHAR(30),
    Cluster VARCHAR(30),
    SiteID VARCHAR(50),
    StateSite VARCHAR(15),
    CaseNumber VARCHAR(50),
    CaseType VARCHAR(30),
    CaseCategory VARCHAR(5),
    CaseStatus VARCHAR(20),
    RootCause1 VARCHAR,
    RootCauseSummarize VARCHAR,
    Technology VARCHAR(10),
    ComplaintLocationLatitude DOUBLE,
    ComplaintLocationLongitude DOUBLE
);

CREATE TABLE IF NOT EXISTS Subscribers (
    SubscribersID INTEGER PRIMARY KEY,
    SubscribersCD TIMESTAMP,
    month VARCHAR(50),
    Period VARCHAR(5),
    "Total Subscribers" INTEGER,
    "Total CTT" INTEGER,
    "Total Coverage Congestion CTT" INTEGER,
    Subscriber DOUBLE,
    Ctt DOUBLE,
    week_number INTEGER,
    month_number INTEGER,
    month_abbreviation VARCHAR(5),
    year INTEGER,
    subscribers_date TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- Subscriber analytics (Zhilabs API in the real system -> synthetic tables)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zl_crm (
    imsi VARCHAR(15) PRIMARY KEY,
    msisdn VARCHAR(15),
    customer_name VARCHAR,
    segment VARCHAR,
    service_type VARCHAR,         -- PREPAID | POSTPAID
    plan_name VARCHAR,
    subscriber_status VARCHAR,    -- ACTIVE | DEACTIVATE | UNKNOWN | BARRED
    home_state VARCHAR,
    date DATE
);

CREATE TABLE IF NOT EXISTS zl_device (
    imsi VARCHAR(15),
    date DATE,
    imei VARCHAR(16),
    device_brand VARCHAR,
    device_model VARCHAR,
    device_type VARCHAR,
    device_os VARCHAR,
    volte INTEGER,
    tethering INTEGER
);

-- One row per data session; feeds visited sites, usage ratio, NBA sessions.
CREATE TABLE IF NOT EXISTS zl_session (
    imsi VARCHAR(15),
    ts TIMESTAMP,
    ts_end TIMESTAMP,
    site_id VARCHAR,
    bearer_cell VARCHAR,
    cluster VARCHAR,
    cell_technology VARCHAR,      -- 4G_TM | 4G_MOCN MAXIS | 5G_DNB | 2G
    signal_type VARCHAR,
    rat VARCHAR,                  -- EUTRAN | NR | GERAN | UTRAN
    mnc INTEGER,                  -- 153 Unifi | 19 MOCN partner | 152 DNB
    cell_frequency VARCHAR,
    bytes_dl BIGINT,
    bytes_ul BIGINT,
    peak_dl_mbps DOUBLE,
    peak_ul_mbps DOUBLE
);

CREATE TABLE IF NOT EXISTS zl_geoloc (
    imsi VARCHAR(15),
    ts TIMESTAMP,
    site_id VARCHAR,
    latitude DOUBLE,
    longitude DOUBLE,
    rsrp DOUBLE,
    sinr DOUBLE
);

CREATE TABLE IF NOT EXISTS zl_speedtest (
    imsi VARCHAR(15),
    ts TIMESTAMP,
    dl_bps BIGINT,
    ul_bps BIGINT,
    host VARCHAR,
    cell_technology VARCHAR,
    site_id VARCHAR
);

CREATE TABLE IF NOT EXISTS zl_app_usage (
    imsi VARCHAR(15),
    date DATE,
    app_name VARCHAR,
    bytes BIGINT
);

CREATE TABLE IF NOT EXISTS zl_volte (
    msisdn VARCHAR(15),
    ts TIMESTAMP,
    call_type VARCHAR,            -- DR | VoLTE
    call_id VARCHAR,
    mos DOUBLE,
    attempts INTEGER,
    answered INTEGER,
    drops INTEGER
);

CREATE TABLE IF NOT EXISTS zl_sms (
    imsi VARCHAR(15),
    date DATE,
    sms_mo INTEGER,
    sms_mt INTEGER
);

-- Mobile dashboard advisory (thd_advisory)
CREATE TABLE IF NOT EXISTS nba_matrix (
    id INTEGER PRIMARY KEY,
    line_status VARCHAR(40),
    internet_connection_matrix VARCHAR(15),
    user_coverage_signal_strength_rsrp VARCHAR(30),
    ntt_site_outage_status BOOLEAN,
    site_congestion_status BOOLEAN,
    plan_maintenance BOOLEAN,
    max_download_speed_megabits VARCHAR(30),
    max_upload_speed_megabits VARCHAR(30),
    total_volume_megabytes VARCHAR(30),
    mos_score_dr VARCHAR(20),
    mos_score_volte VARCHAR(20),
    call_drop_dr VARCHAR(20),
    call_drop_volte VARCHAR(20),
    total_sms VARCHAR(30),
    class_num INTEGER UNIQUE,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nba_advisory (
    id INTEGER PRIMARY KEY,
    class_num INTEGER UNIQUE,
    suspected_root_cause VARCHAR,
    prompt VARCHAR,
    action VARCHAR,
    summary VARCHAR,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- ML next-best-action (map API ML)
CREATE TABLE IF NOT EXISTS ml_model_training (
    id INTEGER PRIMARY KEY,
    line_status VARCHAR,
    quota_usage VARCHAR,
    ntt_status VARCHAR,
    connection_type VARCHAR,
    congestion_status VARCHAR,
    plan_maintenance_status VARCHAR,
    final_rsrp_status VARCHAR,
    final_sinr_status VARCHAR,
    usage_volume VARCHAR,
    volte_total_short_calls_range VARCHAR,
    volte_total_call_attempt_range VARCHAR,
    overall_kpistatus_for_all_provider VARCHAR,
    latency_range VARCHAR,
    cluster VARCHAR
);

CREATE TABLE IF NOT EXISTS ml_nba_advisory (
    id INTEGER PRIMARY KEY,
    class_name VARCHAR,
    summary VARCHAR,
    prompt VARCHAR,
    action_cx VARCHAR,
    action_thd VARCHAR
);

CREATE TABLE IF NOT EXISTS nba_ml_output (
    id INTEGER PRIMARY KEY,
    ml_id INTEGER,
    class_name VARCHAR,
    summary VARCHAR,
    prompt VARCHAR,
    action_cx VARCHAR,
    action_thd VARCHAR,
    distance INTEGER,
    msisdn VARCHAR,
    created_date TIMESTAMP
);

-- Ookla per-test samples (map API)
CREATE TABLE IF NOT EXISTS ookla_mnpd_daily (
    id INTEGER PRIMARY KEY,
    date_id INTEGER,              -- YYYYMMDD
    sim_operator VARCHAR,
    sim_operator_raw VARCHAR,
    latitude DOUBLE,
    longitude DOUBLE,
    qos_packet_loss DOUBLE,
    qos_latency DOUBLE,
    val_multiserver_latency DOUBLE,
    qos_download_throughput DOUBLE,
    qos_upload_throughput DOUBLE,
    rsrp_nerve DOUBLE,
    rsrq_nerve DOUBLE,
    sinr_nerve DOUBLE,
    id_cell_primary INTEGER,
    id_enodeb INTEGER,
    cell_pci INTEGER,
    freq_channel INTEGER,
    freq_channel_type VARCHAR,
    lte_bands VARCHAR,
    connection_type_start VARCHAR,
    connection_type_end VARCHAR,
    val_signal_cqi VARCHAR
);

-- ---------------------------------------------------------------------------
-- NBA collector upstream tables (nba-collector)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subs_profile_daily (
    subs_id VARCHAR PRIMARY KEY,
    msisdn VARCHAR,
    case_created_on TIMESTAMP,
    imsi VARCHAR,
    customer_name VARCHAR,
    address VARCHAR,
    line_activation_date VARCHAR,
    line_termination_date VARCHAR,
    line_termination_reason VARCHAR(50),
    line_status VARCHAR(50),
    account_status VARCHAR(50),
    pay_type_description VARCHAR(50),
    product_group VARCHAR(50),
    segment VARCHAR(50),
    segment_code VARCHAR(50),
    offer_code VARCHAR(50),
    offer_name VARCHAR(50),
    bill_cycle_day INTEGER,
    customer_type VARCHAR(50),
    billing_state VARCHAR(50),
    contract_start_date VARCHAR,
    contract_end_date VARCHAR,
    last_payment_date VARCHAR,
    last_payment_amount DOUBLE,
    latest_bill_date VARCHAR,
    latest_billed_amount DOUBLE,
    latest_account_os DOUBLE
);

CREATE TABLE IF NOT EXISTS pass_quota_daily (
    subs_id DOUBLE,
    msisdn VARCHAR(30),
    gross_bal DOUBLE,
    consume_bal DOUBLE,
    remaining_bal DOUBLE,
    pass_name VARCHAR(300),
    pass_acct_item_type_name VARCHAR(300),
    eff_date VARCHAR,
    exp_date VARCHAR,
    updated_date VARCHAR
);

CREATE TABLE IF NOT EXISTS case_view_daily (
    case_id DOUBLE PRIMARY KEY,
    msisdn VARCHAR,
    cust_name VARCHAR,
    account_status VARCHAR,
    line_status VARCHAR,
    case_status VARCHAR,
    case_created_on TIMESTAMP,
    case_modified_on TIMESTAMP,
    case_sub_area VARCHAR,
    case_category VARCHAR,
    severity VARCHAR,
    priority VARCHAR,
    case_channel VARCHAR,
    sla_time BIGINT,
    sla_unit VARCHAR
);

CREATE TABLE IF NOT EXISTS case_thd_daily (
    case_id BIGINT PRIMARY KEY,
    service_number VARCHAR,
    created_time VARCHAR,
    phone_type VARCHAR,
    phone_model VARCHAR,
    device_characteristic VARCHAR,
    case_category VARCHAR,
    complaint_loc_latlong VARCHAR
);

-- LTE / 5G / MOCN sessions
CREATE TABLE IF NOT EXISTS ime_lte_daily (
    id INTEGER PRIMARY KEY,
    start_time VARCHAR,           -- YYYY-MM-DD
    msisdn VARCHAR,
    imsi VARCHAR,
    imei VARCHAR,
    duration BIGINT,              -- seconds
    lac VARCHAR,
    cell VARCHAR,
    eci VARCHAR,
    enodeb_id VARCHAR,
    mccmnc VARCHAR,
    mccmnc_tai VARCHAR,
    apn VARCHAR,
    data_mode VARCHAR,            -- LTE | 4G_M | 4G_M_DR | DNB
    uplink_bytes BIGINT,
    downlink_bytes BIGINT,
    total_usage_bytes BIGINT
);

-- 2G / 3G (DR) sessions
CREATE TABLE IF NOT EXISTS IMEDRDailyUsage (
    id INTEGER PRIMARY KEY,
    start_time VARCHAR,
    msisdn VARCHAR,
    imsi VARCHAR,
    cell VARCHAR,
    lac VARCHAR,
    duration BIGINT,
    data_mode VARCHAR,            -- DR_2G | DR_3G
    total_usage_bytes BIGINT,
    site_id VARCHAR               -- added: real system resolves via LAC/CELL
);

CREATE TABLE IF NOT EXISTS voice_cdr_daily (
    id INTEGER PRIMARY KEY,
    call_date VARCHAR(30),
    subs_id VARCHAR,
    msisdn VARCHAR,
    total_duration_sec DOUBLE,
    avg_duration_sec DOUBLE,
    total_call_count BIGINT,
    lac_a VARCHAR,
    cell_a VARCHAR,
    mncmcc VARCHAR,
    network_type VARCHAR
);

CREATE TABLE IF NOT EXISTS short_voice_cdr_daily (
    id INTEGER PRIMARY KEY,
    call_date VARCHAR,
    subs_id VARCHAR,
    msisdn VARCHAR,
    total_sc_duration_sec DOUBLE,
    avg_sc_duration_sec DOUBLE,
    total_sc_count VARCHAR(50),
    lac_a VARCHAR,
    cell_a VARCHAR,
    enodeb_id VARCHAR,
    mncmcc VARCHAR,
    network_type VARCHAR
);

-- Per-site daily network KPI (nba-collector network_kpi)
CREATE TABLE IF NOT EXISTS network_kpi (
    site_id VARCHAR,
    kpi_date DATE,
    provider VARCHAR,             -- TM4G | DNB 5G | Maxis 4GMOCN
    latitude DOUBLE,
    longitude DOUBLE,
    -- TM 4G
    cell_availability DOUBLE, call_setup_success_rate DOUBLE, volte_setup_success_rate DOUBLE,
    volte_drop_rate DOUBLE, dl_throughput DOUBLE, prb DOUBLE, active_user DOUBLE,
    -- DNB 5G
    cell_availability_lte DOUBLE, cell_availability_5g DOUBLE, volte_redirection_rate_lte DOUBLE,
    data_session_rate_5g DOUBLE, erab_drop_rate_lte DOUBLE, data_session_abnormal_5g DOUBLE,
    intra_freq_ho_rate_lte DOUBLE, inter_freq_ho_rate_lte DOUBLE, inter_freq_offload_ho_rate_lte DOUBLE,
    intra_sgnb_pscell_change_rate_5g DOUBLE, inter_sgnb_pscell_change_rate_5g DOUBLE, latency DOUBLE,
    -- Maxis 4G MOCN
    data_setup DOUBLE, voice_setup DOUBLE, voice_call_csfb DOUBLE, data_drop DOUBLE,
    voice_drop DOUBLE, intra_handover DOUBLE, inter_handover DOUBLE
);

CREATE TABLE IF NOT EXISTS BinKPI (
    ID INTEGER PRIMARY KEY,
    CreatedDate TIMESTAMP,
    DateID INTEGER,
    Grid_ID INTEGER,
    Site_ID VARCHAR(50),
    SectorID VARCHAR(50),
    Morphology VARCHAR(50),
    Vendor VARCHAR(50),
    CellName VARCHAR,
    enodeb_id INTEGER,
    cell_id INTEGER,
    SampleNO INTEGER,
    distance DOUBLE,
    NoServingCell INTEGER,
    avg_rsrp DOUBLE,
    avg_rsrq DOUBLE,
    sinr DOUBLE,
    cqi DOUBLE,
    UsageVolGB BIGINT,
    ActiveUser INTEGER,
    CellAvailability INTEGER,
    CellStatus VARCHAR(50),
    Congestion VARCHAR(50)
);

-- ---------------------------------------------------------------------------
-- VIP ticketing (thd_ticketing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_group (
    id INTEGER PRIMARY KEY,
    name VARCHAR(150)
);

CREATE TABLE IF NOT EXISTS Groups (
    group_ptr_id INTEGER PRIMARY KEY,
    email VARCHAR(254)
);

CREATE TABLE IF NOT EXISTS THD_Ticket (
    id BIGINT PRIMARY KEY,
    update_l1 VARCHAR(50),
    ctt2 VARCHAR(50) UNIQUE,
    psc_pic VARCHAR(70),
    tt_status VARCHAR(40),
    week_no INTEGER,
    complaint_forward_by VARCHAR(50),
    customer_name VARCHAR(70),
    case_type VARCHAR(30),
    user_details_complaint VARCHAR,
    faulty_msisdn VARCHAR(30),
    phone_brand VARCHAR(70),
    phone_model VARCHAR(80),
    problem VARCHAR(60),
    faulty_location_address VARCHAR(225),
    latitude DOUBLE,
    longitude DOUBLE,
    complaint_datetime TIMESTAMP,
    escalation_datetime TIMESTAMP,
    resolved_datetime TIMESTAMP,
    resolved_hour DOUBLE,
    escalation_hour DOUBLE,
    site_id VARCHAR(100),
    serving_cells VARCHAR(100),
    cluster VARCHAR(40),
    region VARCHAR(30),
    state VARCHAR(40),
    finding VARCHAR,
    avg_cell_availability VARCHAR(30),
    packet_loss VARCHAR(80),
    prb_utilization DOUBLE,
    ntt_number VARCHAR(70),
    cell_upgrade VARCHAR(30),
    nqo_feedback VARCHAR,
    planner_feedback VARCHAR,
    rollout_feedback VARCHAR,
    ims_core_feedback VARCHAR,
    ps_core_feedback VARCHAR,
    soc_feedback VARCHAR,
    celcom_feedback VARCHAR,
    dnb_feedback VARCHAR,
    conclusion VARCHAR,
    recommendation VARCHAR,
    notes VARCHAR,
    root_cause1 VARCHAR(50),
    root_cause2 VARCHAR(80),
    ctt VARCHAR(10),
    month INTEGER,
    year INTEGER,
    running_number INTEGER,
    site_technology VARCHAR(10),
    morphology VARCHAR(30),
    resolve_hour_kpi VARCHAR(30),
    escalation_hour_kpi VARCHAR(30)
);

-- Holds both feedback and remarks (same as the real table)
CREATE TABLE IF NOT EXISTS THD_Ticket_Feedback (
    id BIGINT PRIMARY KEY,
    ticket_id BIGINT,
    group_id INTEGER,
    name VARCHAR(70),
    feedback VARCHAR,
    remark VARCHAR,
    status VARCHAR,
    turn VARCHAR,
    open_date TIMESTAMP,
    close_date TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS THD_Ticket_escalated_groups (
    id BIGINT PRIMARY KEY,
    thdticket_id BIGINT,
    usergroup_id INTEGER
);

-- (synthetic) attachments: no storage exists in the real system
CREATE TABLE IF NOT EXISTS THD_Ticket_Attachment (
    id BIGINT PRIMARY KEY,
    ticket_id BIGINT,
    filename VARCHAR,
    content_type VARCHAR,
    size_bytes BIGINT,
    content BLOB,
    uploaded_by VARCHAR,
    uploaded_at TIMESTAMP
);

-- (synthetic) email outbox: this server never sends real email
CREATE TABLE IF NOT EXISTS THD_Ticket_Email_Log (
    id BIGINT PRIMARY KEY,
    ticket_id BIGINT,
    email_type VARCHAR,           -- new_ticket | escalation
    sender VARCHAR,
    recipients VARCHAR,           -- comma separated
    subject VARCHAR,
    content VARCHAR,
    created_at TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- RAN KPI (OSS daily per-cell counters, KPI_Huawei / KPI_ZTE)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS KPI_Huawei (
    Date DATE,
    Time TIME,
    Cell VARCHAR,
    Site_Cell_ID VARCHAR,
    Integrity DOUBLE,
    Webe_Cell_Availability DOUBLE,
    Webe_Call_Setup_Success_Rate DOUBLE,
    Webe_RRC_Setup_Success_Rate_Service DOUBLE,
    Webe_RRC_Setup_Success_Rate_Signaling DOUBLE,
    Webe_ERAB_Setup_Success_Rate DOUBLE,
    Webe_ERAB_Drop_Rate DOUBLE,
    Webe_RRC_Drop_Rate DOUBLE,
    Webe_Intra_Frequency_Outgoing_Handover_Success_Rate DOUBLE,
    Webe_Inter_Frequency_Outgoing_Handover_Success_Rate DOUBLE,
    Webe_IRAT_Outgoing_Handover_Success_Rate_Prep DOUBLE,
    Webe_CSFB_Redirection_Success_Rate DOUBLE,
    Webe_SRVCC_Success_Rate_Prep DOUBLE,
    Webe_Average_DL_User_Throughput_MB DOUBLE,
    Webe_Average_UL_User_Throughput_MB DOUBLE,
    Webe_DL_Traffic_Volume_GB DOUBLE,
    Webe_UL_Traffic_Volume_GB DOUBLE,
    Webe_Maximum_Cell_DL_Active_User_Number BIGINT,
    Webe_Maximum_Cell_RRC_Connected_User_Number BIGINT,
    Webe_DL_Resource_Block_Utilization DOUBLE,
    Webe_UL_Resource_Block_Utilization DOUBLE,
    Webe_Volte_Setup_Success_Rate DOUBLE,
    Webe_Volte_Drop_Rate DOUBLE,
    Webe_S1_Signal_Establishment_Success_Rate DOUBLE
);
CREATE TABLE IF NOT EXISTS KPI_ZTE AS SELECT * FROM KPI_Huawei WHERE false;

-- (synthetic) 5G DNB daily per-cell KPI; no 5G OSS table exists in the source systems
CREATE TABLE IF NOT EXISTS KPI_DNB_5G (
    Date DATE,
    Cell VARCHAR,
    Site_Cell_ID VARCHAR,
    Site_ID VARCHAR,
    Vendor VARCHAR,
    Integrity DOUBLE,
    Cell_Availability_5G DOUBLE,
    Data_Session_Setup_Success_Rate_5G DOUBLE,
    Data_Session_Abnormal_Release_Rate_5G DOUBLE,
    Intra_SgNB_PSCell_Change_Success_Rate_5G DOUBLE,
    Inter_SgNB_PSCell_Change_Success_Rate_5G DOUBLE,
    Average_DL_User_Throughput_Mbps DOUBLE,
    Average_UL_User_Throughput_Mbps DOUBLE,
    DL_Traffic_Volume_GB DOUBLE,
    UL_Traffic_Volume_GB DOUBLE,
    DL_PRB_Utilization DOUBLE,
    Max_RRC_Connected_Users BIGINT,
    Latency_ms DOUBLE
);

-- ---------------------------------------------------------------------------
-- Convenience views for RAN KPI tools (cell KPIs joined to site inventory)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ran_kpi_4g AS
SELECT k.*, s.Site_ID AS site_id, s.Region AS region, s.Vendor AS vendor, s.Cluster_Name AS cluster,
       s.Latitude AS latitude, s.Longitude AS longitude
FROM (SELECT * FROM KPI_Huawei UNION ALL SELECT * FROM KPI_ZTE) k
JOIN Site4G s ON s.Site_ID = split_part(k.Site_Cell_ID, '_', 1);

CREATE OR REPLACE VIEW ran_kpi_5g AS
SELECT k.* EXCLUDE (Site_ID, Vendor), s.Site_ID AS site_id, s.Region AS region, k.Vendor AS vendor,
       s.District AS cluster, s.Latitude AS latitude, s.Longitude AS longitude
FROM KPI_DNB_5G k JOIN Site5G s ON s.Site_ID = k.Site_ID;

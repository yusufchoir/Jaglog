--
-- PostgreSQL database dump
--

\restrict XG20RzVXyyux8nzGR1711JxVAnQG1Ouh14ecLSGVsL6svMFXMRwRQHO8klKYnx7

-- Dumped from database version 16.14 (Homebrew)
-- Dumped by pg_dump version 16.14 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: yahyahidayatullah
--

CREATE SCHEMA drizzle;


ALTER SCHEMA drizzle OWNER TO yahyahidayatullah;

--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: yahyahidayatullah
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


ALTER TABLE drizzle.__drizzle_migrations OWNER TO yahyahidayatullah;

--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: yahyahidayatullah
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNER TO yahyahidayatullah;

--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: yahyahidayatullah
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: ai_analyses; Type: TABLE; Schema: public; Owner: yahyahidayatullah
--

CREATE TABLE public.ai_analyses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    incident_id uuid,
    period_start timestamp with time zone,
    period_end timestamp with time zone,
    risk_level character varying(20) DEFAULT 'low'::character varying NOT NULL,
    summary text NOT NULL,
    suspected_attack text,
    recommendations jsonb DEFAULT '[]'::jsonb,
    confidence character varying(20) DEFAULT 'sedang'::character varying,
    findings jsonb DEFAULT '[]'::jsonb,
    model character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.ai_analyses OWNER TO yahyahidayatullah;

--
-- Name: client_errors; Type: TABLE; Schema: public; Owner: yahyahidayatullah
--

CREATE TABLE public.client_errors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waktu timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    path character varying(255) NOT NULL,
    pesan text NOT NULL,
    stack text,
    build character varying(50),
    user_agent text,
    sidik_jari character varying(64) NOT NULL,
    jumlah integer DEFAULT 1 NOT NULL,
    terakhir_terjadi timestamp with time zone DEFAULT now() NOT NULL,
    komponen character varying(100),
    status character varying(20) DEFAULT 'baru'::character varying NOT NULL
);


ALTER TABLE public.client_errors OWNER TO yahyahidayatullah;

--
-- Name: device_groups; Type: TABLE; Schema: public; Owner: yahyahidayatullah
--

CREATE TABLE public.device_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nama character varying(100) NOT NULL,
    deskripsi text,
    warna_garis character varying(20) DEFAULT 'biru'::character varying NOT NULL,
    urutan integer DEFAULT 0 NOT NULL,
    parent_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_device_groups_warna_garis CHECK (((warna_garis)::text = ANY ((ARRAY['biru'::character varying, 'merah'::character varying, 'abu'::character varying])::text[])))
);


ALTER TABLE public.device_groups OWNER TO yahyahidayatullah;

--
-- Name: device_log_hourly; Type: TABLE; Schema: public; Owner: yahyahidayatullah
--

CREATE TABLE public.device_log_hourly (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    hour_bucket timestamp with time zone NOT NULL,
    received_count integer DEFAULT 0 NOT NULL,
    stored_count integer DEFAULT 0 NOT NULL,
    dropped_count integer DEFAULT 0 NOT NULL,
    max_gap_seconds integer DEFAULT 0 NOT NULL,
    last_log_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    severity_critical integer DEFAULT 0 NOT NULL,
    severity_error integer DEFAULT 0 NOT NULL,
    severity_warning integer DEFAULT 0 NOT NULL,
    severity_notice integer DEFAULT 0 NOT NULL,
    severity_info integer DEFAULT 0 NOT NULL,
    severity_debug integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.device_log_hourly OWNER TO yahyahidayatullah;

--
-- Name: device_ping_hourly; Type: TABLE; Schema: public; Owner: yahyahidayatullah
--

CREATE TABLE public.device_ping_hourly (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    hour_bucket timestamp with time zone NOT NULL,
    check_count integer DEFAULT 0 NOT NULL,
    success_count integer DEFAULT 0 NOT NULL,
    fail_count integer DEFAULT 0 NOT NULL,
    max_consecutive_rto_seconds integer DEFAULT 0 NOT NULL,
    avg_latency_ms integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.device_ping_hourly OWNER TO yahyahidayatullah;

--
-- Name: device_status_history; Type: TABLE; Schema: public; Owner: yahyahidayatullah
--

CREATE TABLE public.device_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    status character varying(20) NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone
);


ALTER TABLE public.device_status_history OWNER TO yahyahidayatullah;

--
-- Name: devices; Type: TABLE; Schema: public; Owner: yahyahidayatullah
--

CREATE TABLE public.devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    type character varying(50) DEFAULT 'other'::character varying NOT NULL,
    ip_address character varying(45),
    location character varying(150),
    notes text,
    ingest_token_hash character varying(128),
    is_active boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    offline_after_minutes integer DEFAULT 10 NOT NULL,
    ping_enabled boolean DEFAULT false NOT NULL,
    last_ping_at timestamp with time zone,
    last_ping_ok boolean,
    status character varying(20) DEFAULT 'unknown'::character varying NOT NULL,
    status_changed_at timestamp with time zone,
    ping_failure_threshold integer DEFAULT 3 NOT NULL,
    notify_on_rto boolean DEFAULT true NOT NULL,
    last_ping_rtt integer,
    timezone character varying(50) DEFAULT 'Asia/Jakarta'::character varying NOT NULL,
    group_id uuid
);


ALTER TABLE public.devices OWNER TO yahyahidayatullah;

--
-- Name: incidents; Type: TABLE; Schema: public; Owner: yahyahidayatullah
--

CREATE TABLE public.incidents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    rule_key character varying(100) NOT NULL,
    severity character varying(20) DEFAULT 'medium'::character varying NOT NULL,
    title text NOT NULL,
    first_seen timestamp with time zone NOT NULL,
    last_seen timestamp with time zone NOT NULL,
    count integer DEFAULT 1 NOT NULL,
    status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb,
    main_entity character varying(150)
);


ALTER TABLE public.incidents OWNER TO yahyahidayatullah;

--
-- Name: log_events; Type: TABLE; Schema: public; Owner: yahyahidayatullah
--

CREATE TABLE public.log_events (
    id bigint NOT NULL,
    device_id uuid NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    event_time timestamp with time zone NOT NULL,
    severity smallint DEFAULT 6 NOT NULL,
    facility smallint DEFAULT 1,
    source_app character varying(100),
    category character varying(50) DEFAULT 'other'::character varying NOT NULL,
    message text NOT NULL,
    raw text NOT NULL,
    parsed jsonb DEFAULT '{}'::jsonb,
    repeat_count integer DEFAULT 1 NOT NULL,
    first_event_time timestamp with time zone
);


ALTER TABLE public.log_events OWNER TO yahyahidayatullah;

--
-- Name: log_events_id_seq; Type: SEQUENCE; Schema: public; Owner: yahyahidayatullah
--

CREATE SEQUENCE public.log_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.log_events_id_seq OWNER TO yahyahidayatullah;

--
-- Name: log_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: yahyahidayatullah
--

ALTER SEQUENCE public.log_events_id_seq OWNED BY public.log_events.id;


--
-- Name: log_filters; Type: TABLE; Schema: public; Owner: yahyahidayatullah
--

CREATE TABLE public.log_filters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid,
    name character varying(150) NOT NULL,
    match_type character varying(20) DEFAULT 'contains'::character varying NOT NULL,
    pattern text NOT NULL,
    action character varying(20) DEFAULT 'discard'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    match_count bigint DEFAULT 0 NOT NULL,
    last_matched_at timestamp with time zone,
    created_by character varying(50) DEFAULT 'system'::character varying NOT NULL,
    is_system_suggested boolean DEFAULT false NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.log_filters OWNER TO yahyahidayatullah;

--
-- Name: log_top_patterns; Type: TABLE; Schema: public; Owner: yahyahidayatullah
--

CREATE TABLE public.log_top_patterns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    hour_bucket timestamp with time zone NOT NULL,
    normalized_message text NOT NULL,
    example_message text,
    count integer DEFAULT 0 NOT NULL,
    min_severity smallint,
    max_severity smallint,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.log_top_patterns OWNER TO yahyahidayatullah;

--
-- Name: notification_channels; Type: TABLE; Schema: public; Owner: yahyahidayatullah
--

CREATE TABLE public.notification_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    config text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    events jsonb DEFAULT '["ping_rto", "ping_recovered", "device_offline", "device_recovered"]'::jsonb
);


ALTER TABLE public.notification_channels OWNER TO yahyahidayatullah;

--
-- Name: notification_logs; Type: TABLE; Schema: public; Owner: yahyahidayatullah
--

CREATE TABLE public.notification_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_id uuid,
    device_id uuid,
    event_type character varying(50) NOT NULL,
    status character varying(20) NOT NULL,
    details jsonb DEFAULT '{}'::jsonb,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.notification_logs OWNER TO yahyahidayatullah;

--
-- Name: settings; Type: TABLE; Schema: public; Owner: yahyahidayatullah
--

CREATE TABLE public.settings (
    key character varying(100) NOT NULL,
    value text NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.settings OWNER TO yahyahidayatullah;

--
-- Name: topology_links; Type: TABLE; Schema: public; Owner: yahyahidayatullah
--

CREATE TABLE public.topology_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    map_id uuid NOT NULL,
    source_node_id uuid NOT NULL,
    target_node_id uuid NOT NULL,
    label character varying(100),
    tipe character varying(30) DEFAULT 'kabel'::character varying NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_topology_links_no_self CHECK ((source_node_id <> target_node_id))
);


ALTER TABLE public.topology_links OWNER TO yahyahidayatullah;

--
-- Name: topology_maps; Type: TABLE; Schema: public; Owner: yahyahidayatullah
--

CREATE TABLE public.topology_maps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nama character varying(100) NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.topology_maps OWNER TO yahyahidayatullah;

--
-- Name: topology_nodes; Type: TABLE; Schema: public; Owner: yahyahidayatullah
--

CREATE TABLE public.topology_nodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    map_id uuid NOT NULL,
    device_id uuid,
    tipe_virtual character varying(50),
    label character varying(150),
    x double precision DEFAULT 0 NOT NULL,
    y double precision DEFAULT 0 NOT NULL,
    terkunci boolean DEFAULT false NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.topology_nodes OWNER TO yahyahidayatullah;

--
-- Name: user_map_view_states; Type: TABLE; Schema: public; Owner: yahyahidayatullah
--

CREATE TABLE public.user_map_view_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    map_id uuid NOT NULL,
    collapsed_group_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.user_map_view_states OWNER TO yahyahidayatullah;

--
-- Name: users; Type: TABLE; Schema: public; Owner: yahyahidayatullah
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username character varying(50) NOT NULL,
    password_hash text NOT NULL,
    role character varying(20) DEFAULT 'viewer'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    must_change_password boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.users OWNER TO yahyahidayatullah;

--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: yahyahidayatullah
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Name: log_events id; Type: DEFAULT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.log_events ALTER COLUMN id SET DEFAULT nextval('public.log_events_id_seq'::regclass);


--
-- Data for Name: __drizzle_migrations; Type: TABLE DATA; Schema: drizzle; Owner: yahyahidayatullah
--

COPY drizzle.__drizzle_migrations (id, hash, created_at) FROM stdin;
1	3a4e161a1dbf7fa6133dd700b2c0b1e2c4246b16de0d4f7c6b4baa3e88d6e750	1793613612938
2	a8f6b504a4bc9de1bd5a359ce6e1a6b71cfc72eb1e0164d6639ac2e0f3195d08	1793666739587
3	dbfb7bb2c6bc9af5ab9ac32f52bb490ca1c729fe1bb28dcd0263943765005814	1793840975242
4	c96739bccb36a94332641ab53a7738fb74b04979d7dfdc24b91e800041900314	1793899200000
5	f0d90918087de486738d689604d2e8e4692d6bda30e289403f6e6c0a68511bde	1793984000000
6	3323495e402123a98091c8ce22a40cc0416d2a8d1c7806b42ab584ae129c6651	1794100000000
7	caa73b59bde277f4877e0a80eaeda0e1f17acfe7a3b51d5ae1beafc28dad097d	1794200000000
8	839ebe0794c8ba38d6806d283ad33b6392a73e5bc80fcd9f91c5027044c29abd	1794300000000
9	9236535ef8a027473010ef10b493c11bd324104e657491cff81658fe0582a4f3	1794400000000
\.


--
-- Data for Name: ai_analyses; Type: TABLE DATA; Schema: public; Owner: yahyahidayatullah
--

COPY public.ai_analyses (id, device_id, incident_id, period_start, period_end, risk_level, summary, suspected_attack, recommendations, confidence, findings, model, created_at) FROM stdin;
3ad82b10-159c-4a8c-93a2-65d96685d134	59baab7e-ba2d-4278-bc25-b213ae2b9000	4f91fcd1-437f-4b9c-8bd6-31c67028d5cc	\N	\N	high	Terdeteksi percobaan serangan brute force login yang intensif dari alamat IP 10.10.169.192. Pola serangan mencoba membobol kredensial akses administratif melalui layanan jarak jauh. Langkah mitigasi cepat diperlukan untuk memutus upaya autentikasi tersebut.	Brute Force Authentication	[{"action": "Blokir Akses IP Penyerang di Perangkat Jaringan", "reason": "Menghentikan beban autentikasi dan mencegah kebocoran kredensial.", "priority": 1, "device_specific_command": "sudo ufw deny from 10.10.169.192 to any comment \\"JagaLog Block\\""}, {"action": "Evaluasi Pembatasan Akses Manajemen", "reason": "Port manajemen (SSH/Winbox) sebaiknya hanya dapat diakses melalui VPN atau IP manajemen khusus.", "priority": 2}]	tinggi	[{"title": "Percobaan Login Gagal Beruntun dari IP 10.10.169.192", "explanation": "Kegagalan autentikasi berulang dalam frekuensi tinggi mengindikasikan serangan kamus otomatis.", "evidence_event_ids": ["ev-bruteforce-1", "ev-bruteforce-2"]}]	mock	2026-11-03 08:10:30.176491+07
\.


--
-- Data for Name: client_errors; Type: TABLE DATA; Schema: public; Owner: yahyahidayatullah
--

COPY public.client_errors (id, waktu, user_id, path, pesan, stack, build, user_agent, sidik_jari, jumlah, terakhir_terjadi, komponen, status) FROM stdin;
800ebc73-eed0-4e01-ba88-411b6f8365e1	2026-11-13 10:52:26.182474+07	\N	/peta	ManualTest: Uji coba manual setelah perbaikan	\N	1.0.0	curl/8.7.1	dda7dd713ee8f52dbc7b1108c1b391aa8b97df3a581c8311ae85099c7b2100d6	1	2026-11-13 10:52:26.164+07	\N	baru
173a74fe-9ea8-4cba-87ce-9d0e5b71f652	2026-11-13 10:52:55.492405+07	a96ddf36-d585-4437-9836-68df85d801de	/test-simulation	TestSimulationError: Uji coba simulasi penanganan kesalahan klien otomatis	Error: Uji coba\n    at Object.test (app/src/test.ts:1:1)	test-build-1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/157.0.0.0 Safari/537.36	01f2773ed9332b0b5058b579f69062c637660efabdcb38ccb772e1b8586369fc	1	2026-11-13 10:52:55.491+07	SimulationComponent	baru
\.


--
-- Data for Name: device_groups; Type: TABLE DATA; Schema: public; Owner: yahyahidayatullah
--

COPY public.device_groups (id, nama, deskripsi, warna_garis, urutan, parent_id, created_at) FROM stdin;
14292d62-5026-4631-8a99-613082240363	SEMARANG	Wilayah Semarang dan Cabang Operasional	biru	1	\N	2026-11-12 06:59:26.341984+07
0fa9df86-e9d7-485a-8246-6ddd8614c672	CYBER	Data Center & Server Cyber	biru	2	\N	2026-11-12 06:59:26.343882+07
\.


--
-- Data for Name: device_log_hourly; Type: TABLE DATA; Schema: public; Owner: yahyahidayatullah
--

COPY public.device_log_hourly (id, device_id, hour_bucket, received_count, stored_count, dropped_count, max_gap_seconds, last_log_at, updated_at, severity_critical, severity_error, severity_warning, severity_notice, severity_info, severity_debug) FROM stdin;
\.


--
-- Data for Name: device_ping_hourly; Type: TABLE DATA; Schema: public; Owner: yahyahidayatullah
--

COPY public.device_ping_hourly (id, device_id, hour_bucket, check_count, success_count, fail_count, max_consecutive_rto_seconds, avg_latency_ms, updated_at) FROM stdin;
8ab79a6e-2e33-4605-8390-faaf288a7faa	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 03:00:00+07	120	0	120	30	\N	2026-11-11 03:59:44.908898+07
3d38ad01-e76d-4365-8ef9-28ff5a086ee9	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 03:00:00+07	120	0	120	30	\N	2026-11-11 03:59:44.909385+07
ccc65dce-07ac-4aa3-8f4a-f4d1338cd353	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 03:00:00+07	120	0	120	30	\N	2026-11-11 03:59:44.909833+07
66600e09-aec7-4884-8506-d6815eb4da06	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 03:00:00+07	120	0	120	30	\N	2026-11-11 03:59:44.910296+07
60c15d27-6651-4f91-ba73-e47b62d20722	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 03:00:00+07	120	0	120	30	\N	2026-11-11 03:59:44.910665+07
ba9a3e06-31e0-41b7-824e-aa11ba32248d	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 05:00:00+07	98	0	98	30	\N	2026-11-11 05:48:45.243983+07
5489ddf4-03f0-4b6f-82d3-4d0e423b3500	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 05:00:00+07	98	0	98	30	\N	2026-11-11 05:48:45.244779+07
edf98e0c-6e23-4820-a161-6c2509c33cbe	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 05:00:00+07	98	0	98	30	\N	2026-11-11 05:48:45.245399+07
507a9cde-a14e-4b37-9919-46e48477b9d3	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 05:00:00+07	98	0	98	30	\N	2026-11-11 05:48:45.246026+07
567f1d3a-e9d3-4bc9-847a-a51158bd72ee	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 05:00:00+07	98	0	98	30	\N	2026-11-11 05:48:45.246672+07
7f1308c5-852e-4ca2-b94c-742db19dc570	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 07:00:00+07	120	0	120	30	\N	2026-11-11 07:59:34.574462+07
8c76637b-4fd2-4b8a-8834-00b775b58216	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 07:00:00+07	120	0	120	30	\N	2026-11-11 07:59:34.575654+07
d3b77770-0d55-495d-8dfb-6fe66dc0504a	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 07:00:00+07	120	0	120	30	\N	2026-11-11 07:59:34.576651+07
c31d818a-7d97-4657-9966-055cbf94524a	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 07:00:00+07	120	0	120	30	\N	2026-11-11 07:59:34.577804+07
440748af-b416-4013-94f0-dbc0d22ae2ac	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 06:00:00+07	75	0	75	30	\N	2026-11-11 06:59:34.420142+07
c90a9d93-539e-4647-9a65-bafbbf305734	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 06:00:00+07	75	0	75	30	\N	2026-11-11 06:59:34.422678+07
d7e4db79-994a-47a2-a3ba-200bf3f4042f	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 06:00:00+07	75	0	75	30	\N	2026-11-11 06:59:34.424668+07
568cdcd2-6899-415e-a488-3686c86b3dbe	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 06:00:00+07	75	0	75	30	\N	2026-11-11 06:59:34.42622+07
9ee1b5c9-4f28-45dc-9141-29926a103960	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 04:00:00+07	120	0	120	30	\N	2026-11-11 04:59:45.065339+07
ac1ad64e-44a9-40c1-8573-a18a66aa6521	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 04:00:00+07	120	0	120	30	\N	2026-11-11 04:59:45.066763+07
749b3648-c034-4cbc-af04-fd1eff6dd088	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 04:00:00+07	120	0	120	30	\N	2026-11-11 04:59:45.067257+07
f8b5fd8e-826c-421b-903e-079f30dcaec0	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 04:00:00+07	120	0	120	30	\N	2026-11-11 04:59:45.06764+07
ab02287b-7e5f-4854-acf3-882ac7bfb421	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 02:00:00+07	120	0	120	30	\N	2026-11-11 02:59:44.774963+07
00789608-d8e3-47a5-a052-e8ad9f202871	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 02:00:00+07	120	0	120	30	\N	2026-11-11 02:59:44.776595+07
0bfbce40-ea82-498f-849f-07e5d26b4ae5	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 01:00:00+07	105	0	105	30	\N	2026-11-11 01:59:44.408798+07
05031f72-d884-4d4e-bbf4-d786fb416ea0	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 01:00:00+07	105	0	105	30	\N	2026-11-11 01:59:44.41061+07
af68c10e-5318-4b52-894d-36c7fe8dbacb	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 01:00:00+07	105	0	105	30	\N	2026-11-11 01:59:44.41172+07
72644593-5662-4a43-82b5-b9494f802500	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 01:00:00+07	105	0	105	30	\N	2026-11-11 01:59:44.412952+07
33c2957d-6d0a-478c-bc11-cc93d8f6f3dd	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 01:00:00+07	105	0	105	30	\N	2026-11-11 01:59:44.416199+07
8a86a1d5-2388-49f2-893b-51cd413d9f29	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 01:00:00+07	105	0	105	30	\N	2026-11-11 01:59:44.421019+07
db86e514-531d-4509-a174-1ac62c8fb310	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 02:00:00+07	120	0	120	30	\N	2026-11-11 02:59:44.778467+07
fdbd41e0-88d5-4756-9e95-aba2ebe1749e	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 02:00:00+07	120	0	120	30	\N	2026-11-11 02:59:44.780063+07
0e9e94de-f0bd-45ef-a5db-861a6bb83f0b	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 02:00:00+07	120	0	120	30	\N	2026-11-11 02:59:44.781172+07
f9123f29-9203-4b46-a376-e7990c532cd7	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 02:00:00+07	120	0	120	30	\N	2026-11-11 02:59:44.782127+07
9bcadee9-47a5-460d-878e-cda7a32f9d1d	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 04:00:00+07	120	0	120	30	\N	2026-11-11 04:59:45.068153+07
4d676636-db79-4cd6-8a67-18118aaef7f3	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 04:00:00+07	120	0	120	30	\N	2026-11-11 04:59:45.068712+07
d63e1413-9b6f-4899-9eab-cfe4441169dc	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 06:00:00+07	75	0	75	30	\N	2026-11-11 06:59:34.42763+07
472b3085-9109-4001-930b-44a0c7dbecda	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 06:00:00+07	75	0	75	30	\N	2026-11-11 06:59:34.429097+07
de6f5d98-697b-4520-a8ac-c7779137f8de	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 10:00:00+07	120	0	120	30	\N	2026-11-11 10:59:54.531038+07
8eb6c6e7-eef9-411f-af43-9e4d2b53f602	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 10:00:00+07	120	0	120	30	\N	2026-11-11 10:59:54.53237+07
455a3b61-ff37-4a1b-a102-14c727e9b925	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 10:00:00+07	120	0	120	30	\N	2026-11-11 10:59:54.533076+07
f576b437-42a6-481b-b593-efa8147898b2	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 03:00:00+07	120	0	120	30	\N	2026-11-11 03:59:44.907972+07
2aea4cc0-d7ce-48e7-9b41-537771a694ed	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 10:00:00+07	120	0	120	30	\N	2026-11-11 10:59:54.533827+07
5090338d-1431-4ac4-846f-d78dec629a04	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 10:00:00+07	120	0	120	30	\N	2026-11-11 10:59:54.534424+07
5a0c0986-990d-42f1-84da-b052ce0088d5	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 10:00:00+07	120	0	120	30	\N	2026-11-11 10:59:54.53506+07
ac9c063b-d1b9-4c1f-b926-10864274fa8b	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 09:00:00+07	90	0	90	30	\N	2026-11-11 09:59:54.330486+07
e51ea176-e900-4cc8-ab3a-3b9af147004a	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 09:00:00+07	90	0	90	30	\N	2026-11-11 09:59:54.332128+07
a894d494-2aeb-4b6e-a9d7-7dad5ea5b8d5	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 09:00:00+07	90	0	90	30	\N	2026-11-11 09:59:54.332941+07
51e33658-519f-409a-b522-1d91caa9b0d1	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 09:00:00+07	90	0	90	30	\N	2026-11-11 09:59:54.333655+07
393783b8-4e84-44a1-9d31-218a7ccf7246	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 09:00:00+07	90	0	90	30	\N	2026-11-11 09:59:54.334353+07
8401c903-3a25-4de4-8456-24e62941e28b	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 09:00:00+07	90	0	90	30	\N	2026-11-11 09:59:54.335029+07
4e3d5362-458b-429a-994a-3d9e7e3fb16d	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 12:00:00+07	14	0	14	30	\N	2026-11-11 12:38:38.716877+07
d0679182-ae3d-477e-9cd1-45085a5a8ca2	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 13:00:00+07	38	0	38	30	\N	2026-11-11 13:58:15.216265+07
7e654a06-9924-44cd-997b-c66992e4f688	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 11:00:00+07	101	0	101	30	\N	2026-11-11 11:59:39.813241+07
c553cf32-f58b-46ef-98fb-3881d50884a5	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 05:00:00+07	98	0	98	30	\N	2026-11-11 05:48:45.243096+07
c54d759a-8c70-4908-9076-e3bc143e12a2	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 12:00:00+07	14	0	14	30	\N	2026-11-11 12:38:38.711609+07
3cf679bf-1f27-476a-b509-e0db9933713f	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 08:00:00+07	120	0	120	30	\N	2026-11-11 08:59:34.904955+07
441e3cdc-6c26-4fce-a799-37227fcd34f5	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 08:00:00+07	120	0	120	30	\N	2026-11-11 08:59:34.906524+07
0784daca-6535-46f5-be76-b24738b510f0	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 11:00:00+07	101	0	101	30	\N	2026-11-11 11:59:39.814319+07
125fc584-4b59-4bad-98cd-a028c5867d6b	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 11:00:00+07	101	0	101	30	\N	2026-11-11 11:59:39.815396+07
fb6bd986-4c8b-4955-b698-8b281eecefd4	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 07:00:00+07	120	0	120	30	\N	2026-11-11 07:59:34.571368+07
42e0a5d2-5a6c-4a1e-8114-ad495f918808	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 07:00:00+07	120	0	120	30	\N	2026-11-11 07:59:34.573201+07
d61481c8-ed68-4f99-86f1-61cd616d5095	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 08:00:00+07	120	0	120	30	\N	2026-11-11 08:59:34.907233+07
483b0314-3afe-47fe-abec-522690b7d227	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 08:00:00+07	120	0	120	30	\N	2026-11-11 08:59:34.907716+07
43c3d77b-5a6c-40d1-a73e-8e1e243aabc0	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 08:00:00+07	120	0	120	30	\N	2026-11-11 08:59:34.908145+07
570eb567-bdf8-4b39-97d6-659dc7288278	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 08:00:00+07	120	0	120	30	\N	2026-11-11 08:59:34.908691+07
bd2c8049-2296-48ca-a8bf-4484aaab3108	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 11:00:00+07	101	0	101	30	\N	2026-11-11 11:59:39.809435+07
ecf11af2-46dc-4a6c-9018-763020274e9f	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 11:00:00+07	101	0	101	30	\N	2026-11-11 11:59:39.816018+07
279a76eb-eb6a-4f09-a458-eef547aedc21	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 11:00:00+07	101	0	101	30	\N	2026-11-11 11:59:39.811722+07
cf079a1a-f7a2-4c8a-a096-aaab1df272be	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 12:00:00+07	14	0	14	30	\N	2026-11-11 12:38:38.713316+07
5216606b-ba8a-49f3-b214-5d1e50cc75cd	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 12:00:00+07	14	0	14	30	\N	2026-11-11 12:38:38.715662+07
0953fee8-9608-40e9-b5ea-5ef153511b35	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 12:00:00+07	14	0	14	30	\N	2026-11-11 12:38:38.714321+07
9a9c2980-edf9-49cd-ae9b-d1121a499185	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 12:00:00+07	14	0	14	30	\N	2026-11-11 12:38:38.716453+07
9f4dee6d-a505-41a9-87ea-bc956fc7f146	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 13:00:00+07	38	0	38	30	\N	2026-11-11 13:58:15.21768+07
e5073609-0216-45c2-b57e-6eb70e653cfe	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 13:00:00+07	38	0	38	30	\N	2026-11-11 13:58:15.218593+07
c4ff0257-a146-49b7-beb8-0f090aa4e0a9	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 13:00:00+07	38	0	38	30	\N	2026-11-11 13:58:15.219516+07
389f4609-bc13-4eb4-acaf-4d06f588efa9	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 13:00:00+07	38	0	38	30	\N	2026-11-11 13:58:15.220743+07
629cbac6-7886-4fbe-9bb0-03a81213e0cd	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 16:00:00+07	119	0	119	30	\N	2026-11-11 16:59:31.273865+07
0f32e0d3-705c-422f-a808-5da2d9c4f3a6	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 16:00:00+07	119	0	119	30	\N	2026-11-11 16:59:31.275655+07
e2b01280-4569-433c-8376-448f56793b30	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 16:00:00+07	119	0	119	30	\N	2026-11-11 16:59:31.276514+07
ca7d56c3-7ad8-4f82-8241-6eb31b3c0091	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 16:00:00+07	119	0	119	30	\N	2026-11-11 16:59:31.277288+07
9e188c38-eeb3-4b49-93b1-69651446831a	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 16:00:00+07	119	0	119	30	\N	2026-11-11 16:59:31.278068+07
0d94961a-a12d-4514-b5f4-fcff1d6514d8	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 16:00:00+07	119	0	119	30	\N	2026-11-11 16:59:31.278775+07
9b00a0a8-ed5b-4179-8c82-812ba74d2cb9	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 20:00:00+07	81	0	81	30	\N	2026-11-11 20:59:54.606552+07
bdf3cc08-b7e9-4df3-9c15-423730c795a6	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 21:00:00+07	120	0	120	30	\N	2026-11-11 21:59:54.813692+07
b38d9ec8-368b-4e64-947d-46d274c736ca	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 19:00:00+07	120	0	120	30	\N	2026-11-11 19:59:31.918392+07
5fcf1d1f-f9a7-4882-964c-3ae7b15d1022	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 19:00:00+07	120	0	120	30	\N	2026-11-11 19:59:31.919621+07
3459f130-6d7f-435f-a6bd-99c276ffeb29	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 19:00:00+07	120	0	120	30	\N	2026-11-11 19:59:31.920478+07
885ca2d5-4d2d-4f00-ae78-085bea6ab6a3	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 19:00:00+07	120	0	120	30	\N	2026-11-11 19:59:31.92131+07
649c469b-fbd8-4ea7-af4c-326099a8666b	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 19:00:00+07	120	0	120	30	\N	2026-11-11 19:59:31.922092+07
1a8d18a7-2a3e-46cd-aa80-2960b847ae91	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 19:00:00+07	120	0	120	30	\N	2026-11-11 19:59:31.92282+07
877396a2-a2ba-4f96-ada2-531d00a05d5c	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 21:00:00+07	120	0	120	30	\N	2026-11-11 21:59:54.814154+07
f909214d-2f35-4423-96f1-09874b81e5e5	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 13:00:00+07	38	0	38	30	\N	2026-11-11 13:58:15.222328+07
01c1cc7d-282e-4fc2-89f8-a368f883ad4b	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 14:00:00+07	35	0	35	30	\N	2026-11-11 14:56:51.609685+07
bc474bc7-fb1c-4d84-acfb-42a90f709d8e	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 14:00:00+07	35	0	35	30	\N	2026-11-11 14:56:51.610302+07
11ca7607-521a-4906-ab8e-0816607069ae	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 14:00:00+07	35	0	35	30	\N	2026-11-11 14:56:51.610799+07
78420fec-d998-4d39-95fb-06ff9e5a830d	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 14:00:00+07	35	0	35	30	\N	2026-11-11 14:56:51.611248+07
eb7495f5-85d2-4a6f-82ee-459047d99e2f	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 14:00:00+07	35	0	35	30	\N	2026-11-11 14:56:51.611677+07
fcc23fdb-81ed-49a2-9837-7f2b6bd771cd	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 14:00:00+07	35	0	35	30	\N	2026-11-11 14:56:51.612472+07
50a109aa-ebe2-4ace-a348-bf6a9304b794	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 22:00:00+07	120	0	120	30	\N	2026-11-11 22:59:55.035287+07
f9b96393-dd69-42e4-99fc-4cba2c7ec6db	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 22:00:00+07	120	0	120	30	\N	2026-11-11 22:59:55.035876+07
bce1534f-421e-460c-9f68-d7f3e286eac6	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 23:00:00+07	120	0	120	30	\N	2026-11-11 23:59:55.324447+07
62cdd3b1-0c92-4359-bec6-4e2543f43236	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 18:00:00+07	120	0	120	30	\N	2026-11-11 18:59:31.652617+07
b675631e-82ae-4a16-9a92-10a102f6266c	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 18:00:00+07	120	0	120	30	\N	2026-11-11 18:59:31.653799+07
c7b30889-4b86-48b2-a17d-3402bf903f36	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 18:00:00+07	120	0	120	30	\N	2026-11-11 18:59:31.654257+07
085e8d75-553c-40b6-b032-0de650ff57b6	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 18:00:00+07	120	0	120	30	\N	2026-11-11 18:59:31.654791+07
68272adf-e666-41e7-966b-e959fc5e3685	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 15:00:00+07	84	0	84	30	\N	2026-11-11 15:59:58.424869+07
17b64333-7a33-44dc-9ee3-4609d32e9ed9	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 15:00:00+07	84	0	84	30	\N	2026-11-11 15:59:58.426314+07
ef66ca79-72a2-496b-b9e8-31b07c79a520	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 18:00:00+07	120	0	120	30	\N	2026-11-11 18:59:31.65529+07
e1fc2266-6360-4a6e-9189-bb6370e7f0c6	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 15:00:00+07	84	0	84	30	\N	2026-11-11 15:59:58.427502+07
8122c569-774d-4809-8ea3-eceef6c1aaa1	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 15:00:00+07	84	0	84	30	\N	2026-11-11 15:59:58.428885+07
5685ee49-7798-4b4d-a5ff-bc39a58d75c2	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 15:00:00+07	84	0	84	30	\N	2026-11-11 15:59:58.430064+07
0bd31990-bd01-4c1e-80be-0a6e7975b241	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 15:00:00+07	84	0	84	30	\N	2026-11-11 15:59:58.430831+07
ded7585e-8128-413b-9715-934273941de3	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 18:00:00+07	120	0	120	30	\N	2026-11-11 18:59:31.655799+07
993ebead-c911-4039-9b1d-c61a1ec03734	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 17:00:00+07	120	0	120	30	\N	2026-11-11 17:59:31.362663+07
e4e9211c-f9a1-4b97-9170-bbc3baee7ed0	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 17:00:00+07	120	0	120	30	\N	2026-11-11 17:59:31.36386+07
cff2386b-fa25-48c3-840f-e4f94421852d	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 17:00:00+07	120	0	120	30	\N	2026-11-11 17:59:31.364782+07
ec42690c-dcc2-44d3-8226-0aa7a1634159	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 17:00:00+07	120	0	120	30	\N	2026-11-11 17:59:31.365237+07
cff3cf62-33d6-42c1-b981-6c0194487e5f	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 17:00:00+07	120	0	120	30	\N	2026-11-11 17:59:31.365671+07
3a02fd6e-2d83-43fe-b1eb-7eef3374471b	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-11 17:00:00+07	120	0	120	30	\N	2026-11-11 17:59:31.366148+07
b0352841-7e23-4837-90d6-4428043e86b5	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 20:00:00+07	81	0	81	30	\N	2026-11-11 20:59:54.603233+07
038a2c7d-68ba-4a0e-a78b-00596a88818a	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 20:00:00+07	81	0	81	30	\N	2026-11-11 20:59:54.604396+07
1b200067-7627-4023-9269-3010b70e7fe3	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 20:00:00+07	81	0	81	30	\N	2026-11-11 20:59:54.605247+07
f2bb0f02-d141-4387-90d0-ab3f96460d17	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 20:00:00+07	81	0	81	30	\N	2026-11-11 20:59:54.605722+07
2da2d928-ccd6-464e-82cd-5e7ff2968249	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 20:00:00+07	81	0	81	30	\N	2026-11-11 20:59:54.606138+07
93dea7a7-d334-4fe2-9420-8776ff900e02	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 21:00:00+07	120	0	120	30	\N	2026-11-11 21:59:54.810045+07
c40cc400-b893-44a7-8f12-3c28fd454474	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 21:00:00+07	120	0	120	30	\N	2026-11-11 21:59:54.811951+07
81b25bc8-6e25-4774-bb73-1c352dfcf347	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 21:00:00+07	120	0	120	30	\N	2026-11-11 21:59:54.812715+07
954a1fa9-e4f3-43ff-a1c3-a1ea38f482cd	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 21:00:00+07	120	0	120	30	\N	2026-11-11 21:59:54.813221+07
2e8f8dbd-7102-4e19-98b9-8eca003faff9	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-12 01:00:00+07	101	0	101	30	\N	2026-11-12 01:59:55.57272+07
5160f7a1-d0fe-4dd4-8b81-ce7999b3747f	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-12 00:00:00+07	110	0	110	30	\N	2026-11-12 00:54:55.417372+07
2b19e37e-39a4-45a0-8d2f-3191ed1be727	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-12 00:00:00+07	110	0	110	30	\N	2026-11-12 00:54:55.424502+07
4df1ae03-d798-416d-a332-455691b12d43	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-12 00:00:00+07	110	0	110	30	\N	2026-11-12 00:54:55.425367+07
ab8a455d-c9cf-435e-99ca-4ab6cdbb7e98	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 22:00:00+07	120	0	120	30	\N	2026-11-11 22:59:55.030148+07
fa4ecff5-caf5-4375-b315-ee4c0e1c92f4	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 22:00:00+07	120	0	120	30	\N	2026-11-11 22:59:55.03193+07
14329c01-009c-4857-a466-d2a184cd9be7	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 22:00:00+07	120	0	120	30	\N	2026-11-11 22:59:55.033792+07
5403f918-ac22-4f6e-8fea-849f9450a731	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 22:00:00+07	120	0	120	30	\N	2026-11-11 22:59:55.034651+07
048e9236-c95e-4699-ab27-f1a6c12c2ce2	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-12 00:00:00+07	110	0	110	30	\N	2026-11-12 00:54:55.42675+07
50e2d07e-716d-4acc-b0df-39bbfc73bd0d	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-11 23:00:00+07	120	0	120	30	\N	2026-11-11 23:59:55.318474+07
ea36aa1e-d130-45fa-893c-4821d1e31de3	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-11 23:00:00+07	120	0	120	30	\N	2026-11-11 23:59:55.321461+07
56a6a62a-0332-45d7-bf08-da2ef2212276	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-11 23:00:00+07	120	0	120	30	\N	2026-11-11 23:59:55.322296+07
6982e15a-a238-4a3e-b605-192c959db984	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-11 23:00:00+07	120	0	120	30	\N	2026-11-11 23:59:55.323036+07
a7a0a0a6-77ea-44d2-8389-778ae728af2a	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-11 23:00:00+07	120	0	120	30	\N	2026-11-11 23:59:55.323828+07
604b9761-6362-466b-a0f1-0634114f1b26	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-12 00:00:00+07	110	0	110	30	\N	2026-11-12 00:54:55.421734+07
214101db-efea-422b-843e-681166f95b9e	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-12 00:00:00+07	110	0	110	30	\N	2026-11-12 00:54:55.423312+07
4ef9ea08-25a4-45b9-87a8-cf9714ac3f3e	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-12 01:00:00+07	101	0	101	30	\N	2026-11-12 01:59:55.573731+07
3ac2c4e1-9b04-437c-9f08-1c7eab485d09	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-12 01:00:00+07	101	0	101	30	\N	2026-11-12 01:59:55.572199+07
09267860-20f5-4907-88c1-75377e493627	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-12 01:00:00+07	101	0	101	30	\N	2026-11-12 01:59:55.573222+07
3d358f48-6370-4336-9aa2-7077c48c07c8	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-12 01:00:00+07	101	0	101	30	\N	2026-11-12 01:59:55.574764+07
20ae746f-5d35-432b-a560-514784328c25	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-12 01:00:00+07	101	0	101	30	\N	2026-11-12 01:59:55.57148+07
24e403c6-5476-498d-9289-a10cbf722487	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-12 02:00:00+07	120	0	120	30	\N	2026-11-12 02:59:55.8168+07
ce120055-c250-4599-8e07-497e8668e113	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-12 02:00:00+07	120	0	120	30	\N	2026-11-12 02:59:55.818185+07
6be89ec8-acc6-4a90-a91f-4a1a068e7edf	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-12 02:00:00+07	120	0	120	30	\N	2026-11-12 02:59:55.818835+07
afb88130-0df9-47b2-b451-8dd3907bb30c	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-12 02:00:00+07	120	0	120	30	\N	2026-11-12 02:59:55.81946+07
107c6eeb-2362-45a6-97b4-794511d8ef0a	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-12 03:00:00+07	120	0	120	30	\N	2026-11-12 03:59:56.105602+07
9d878a93-a02a-48ca-a9db-c884f976d5b0	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-12 03:00:00+07	120	0	120	30	\N	2026-11-12 03:59:56.108583+07
1723184b-18b9-47bf-af44-8fcf5c75928c	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-12 03:00:00+07	120	0	120	30	\N	2026-11-12 03:59:56.10958+07
464b7d60-794d-4c1e-89cb-55a79cd52741	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-12 07:00:00+07	120	0	120	30	\N	2026-11-12 07:59:49.138726+07
25dd8d93-7652-4db9-9e42-ddc415306c8b	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-12 07:00:00+07	120	0	120	30	\N	2026-11-12 07:59:49.140603+07
2c6ed1a6-9726-4eb1-929f-1531fee43fba	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-12 07:00:00+07	120	0	120	30	\N	2026-11-12 07:59:49.141175+07
6723c8d0-6365-4618-8756-66ee316dad56	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-12 07:00:00+07	120	0	120	30	\N	2026-11-12 07:59:49.141585+07
0086d463-d9d0-4844-bb9b-ada9ec0a7408	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-12 06:00:00+07	120	0	120	30	\N	2026-11-12 06:59:56.731455+07
b384afaf-9327-40b5-9488-fa0f4010ca12	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-12 06:00:00+07	120	0	120	30	\N	2026-11-12 06:59:56.732175+07
e02320d2-eaa9-41ca-a7a5-a43158f890f4	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-12 06:00:00+07	120	0	120	30	\N	2026-11-12 06:59:56.732665+07
f5865eb6-8e29-429a-99be-75d7bed11773	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-12 06:00:00+07	120	0	120	30	\N	2026-11-12 06:59:56.733102+07
deac936b-a82d-4909-b160-fa2c48948623	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-12 02:00:00+07	120	0	120	30	\N	2026-11-12 02:59:55.820494+07
b512e403-7ac2-4296-864a-8fd8c97d71d7	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-12 05:00:00+07	120	0	120	30	\N	2026-11-12 05:59:56.539226+07
59820155-d28b-4d22-b2be-89e554db1366	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-12 04:00:00+07	120	0	120	30	\N	2026-11-12 04:59:56.314163+07
080ef966-c070-4dbc-b228-a64399acb32e	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-12 04:00:00+07	120	0	120	30	\N	2026-11-12 04:59:56.316515+07
5821245e-f28b-4377-808a-0b773c8b5c36	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-12 04:00:00+07	120	0	120	30	\N	2026-11-12 04:59:56.316955+07
63eae79e-cf0e-4018-ac78-141301b38266	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-12 04:00:00+07	120	0	120	30	\N	2026-11-12 04:59:56.317367+07
1cfc8e9c-c412-4738-84fc-ef48bb184545	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-12 05:00:00+07	120	0	120	30	\N	2026-11-12 05:59:56.53988+07
b399885b-f35d-4164-b577-eb59b50733b1	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-12 05:00:00+07	120	0	120	30	\N	2026-11-12 05:59:56.540434+07
7a657db5-e1a5-4a06-b707-744097781826	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-12 05:00:00+07	120	0	120	30	\N	2026-11-12 05:59:56.540912+07
71cafaf6-df0d-473d-b127-5494d94a2c6b	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-12 05:00:00+07	120	0	120	30	\N	2026-11-12 05:59:56.541411+07
71281b86-62eb-44a8-abfc-b68ad4a30a67	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-12 08:00:00+07	4	0	4	30	\N	2026-11-12 08:01:49.19321+07
b2c919aa-7663-48a1-a388-768fc00db4b2	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-12 08:00:00+07	4	0	4	30	\N	2026-11-12 08:01:49.193522+07
189bea10-e807-4af9-98ca-85923268160e	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-12 08:00:00+07	4	0	4	30	\N	2026-11-12 08:01:49.194053+07
4cd3469f-4ba2-4218-9328-2e2b059ee94c	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-12 08:00:00+07	4	0	4	30	\N	2026-11-12 08:01:49.194334+07
f3cbdf0e-28e9-4a18-9ecf-6facb6ac89ac	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-12 03:00:00+07	120	0	120	30	\N	2026-11-12 03:59:56.106963+07
6888ee41-a046-4bfb-afed-fac9044a5f55	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-12 03:00:00+07	120	0	120	30	\N	2026-11-12 03:59:56.107541+07
cd994717-1f42-4f3f-b502-2076f34e9dc7	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-12 03:00:00+07	120	0	120	30	\N	2026-11-12 03:59:56.109114+07
3426892b-0ba4-42da-9493-3c9fd6fe440a	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-12 04:00:00+07	120	0	120	30	\N	2026-11-12 04:59:56.315536+07
0c1069a8-e16c-4b88-bbfb-378d55a3862d	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-12 04:00:00+07	120	0	120	30	\N	2026-11-12 04:59:56.316092+07
1c98407f-d20a-4c1b-b02b-6b180cd8eaf0	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-12 02:00:00+07	120	0	120	30	\N	2026-11-12 02:59:55.821296+07
7155d1f0-f085-4b4a-a70e-52f97b16551d	d2e142d2-8930-4e04-93ce-15ebad7103c3	2026-11-12 05:00:00+07	120	0	120	30	\N	2026-11-12 05:59:56.537609+07
4d01ce20-550e-4efa-b0ff-d88ad3974d90	e02d1110-e2d1-4eff-902d-4ed057357b98	2026-11-12 07:00:00+07	120	0	120	30	\N	2026-11-12 07:59:49.139853+07
32f8536e-7500-408a-9505-a6f994b53664	e8964be7-c02c-4cef-91d5-cd673ec76986	2026-11-12 07:00:00+07	120	0	120	30	\N	2026-11-12 07:59:49.142007+07
aa3cb3c2-f20c-490e-90b7-756194e7e312	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-12 06:00:00+07	120	0	120	30	\N	2026-11-12 06:59:56.733707+07
8487f7f3-5bd6-4081-a9dc-b26634fe3dde	2069639d-cbdd-4d1c-90d7-b5421797ec06	2026-11-12 06:00:00+07	120	0	120	30	\N	2026-11-12 06:59:56.734107+07
0b5b5d6e-8da0-4630-a1d4-e94152db07ba	58e4fedb-6b83-4e8c-8c9f-c12387a10217	2026-11-12 08:00:00+07	4	0	4	30	\N	2026-11-12 08:01:49.192609+07
828d8906-3cda-48b4-a5bc-987ded3bdb51	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	2026-11-12 08:00:00+07	4	0	4	30	\N	2026-11-12 08:01:49.193801+07
\.


--
-- Data for Name: device_status_history; Type: TABLE DATA; Schema: public; Owner: yahyahidayatullah
--

COPY public.device_status_history (id, device_id, status, started_at, ended_at) FROM stdin;
0d48fdcb-f9c0-413b-abf3-09de0439c11c	e02d1110-e2d1-4eff-902d-4ed057357b98	offline	2026-11-11 01:08:14.215+07	2026-11-11 01:09:14.209+07
8337b1ed-3394-4d1e-9da3-a7fb2fb6da5b	e02d1110-e2d1-4eff-902d-4ed057357b98	rto	2026-11-11 01:09:14.209+07	\N
4f99fb91-b3e0-4264-898a-ec7f8bdfe319	d2e142d2-8930-4e04-93ce-15ebad7103c3	offline	2026-11-11 01:08:14.215+07	2026-11-11 01:09:14.209+07
adbe99cd-b021-44b3-a6e2-d5ddbf9a22ce	d2e142d2-8930-4e04-93ce-15ebad7103c3	rto	2026-11-11 01:09:14.209+07	\N
c4500383-06be-412f-8a14-97ed3092d730	58e4fedb-6b83-4e8c-8c9f-c12387a10217	offline	2026-11-11 01:08:14.215+07	2026-11-11 01:09:14.209+07
e1489626-2155-4482-990c-e7db7cbc0f17	58e4fedb-6b83-4e8c-8c9f-c12387a10217	rto	2026-11-11 01:09:14.209+07	\N
2961bfb0-5fc0-4e14-9150-5bb8adb74813	2069639d-cbdd-4d1c-90d7-b5421797ec06	offline	2026-11-11 01:08:14.215+07	2026-11-11 01:09:14.209+07
9294cbd8-81a0-495d-b78e-62eead16b7dc	2069639d-cbdd-4d1c-90d7-b5421797ec06	rto	2026-11-11 01:09:14.209+07	\N
d16230bd-a0ed-4ebf-a49b-d75dac1cd57a	e8964be7-c02c-4cef-91d5-cd673ec76986	offline	2026-11-11 01:08:14.215+07	2026-11-11 01:09:14.209+07
e9132f66-f785-4f1d-9f38-9dc8f2568258	e8964be7-c02c-4cef-91d5-cd673ec76986	rto	2026-11-11 01:09:14.209+07	\N
82ea79ea-3fb6-4553-90f5-f666c207903f	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	rto	2026-11-11 01:09:14.209+07	\N
\.


--
-- Data for Name: devices; Type: TABLE DATA; Schema: public; Owner: yahyahidayatullah
--

COPY public.devices (id, name, type, ip_address, location, notes, ingest_token_hash, is_active, last_seen_at, created_at, offline_after_minutes, ping_enabled, last_ping_at, last_ping_ok, status, status_changed_at, ping_failure_threshold, notify_on_rto, last_ping_rtt, timezone, group_id) FROM stdin;
58e4fedb-6b83-4e8c-8c9f-c12387a10217	Server DB PostgreSQL Linux	linux	10.250.1.10	Kantor Pusat — Data Center	[DEMO] Server database produksi	46f8ffa21e10cf36001d86bf59ca2e4ef73b6ed431510d3acfc25a92aab3f41b	t	2026-11-10 08:21:21.359+07	2026-11-10 08:21:21.360763+07	10	t	2026-11-12 08:01:49.115+07	f	rto	2026-11-11 01:09:14.209+07	3	t	\N	Asia/Jakarta	\N
e02d1110-e2d1-4eff-902d-4ed057357b98	Router Core CCR2004	mikrotik	10.250.1.1	Kantor Pusat — Data Center	[DEMO] Router gateway utama kantor pusat	46f8ffa21e10cf36001d86bf59ca2e4ef73b6ed431510d3acfc25a92aab3f41b	t	2026-11-10 08:21:21.359+07	2026-11-10 08:21:21.359693+07	10	t	2026-11-12 08:01:49.115+07	f	rto	2026-11-11 01:09:14.209+07	3	t	\N	Asia/Jakarta	\N
d2e142d2-8930-4e04-93ce-15ebad7103c3	Switch Distribusi DC-1	switch	10.250.1.2	Kantor Pusat — Data Center	[DEMO] Switch core server rack 1	46f8ffa21e10cf36001d86bf59ca2e4ef73b6ed431510d3acfc25a92aab3f41b	t	2026-11-10 08:21:21.359+07	2026-11-10 08:21:21.360302+07	10	t	2026-11-12 08:01:49.115+07	f	rto	2026-11-11 01:09:14.209+07	3	t	\N	Asia/Jakarta	\N
9ebd859f-a55d-4d70-a30b-fc2898f70823	MikroTik-Router-5770	mikrotik	192.168.157.7	Kantor Pusat Lt. 1	Router utama gateway internet	6b8f45d62b960ac5d5f5160dda8b6a94cc1666cc584cae5b5903dfd96926bebb	f	\N	2026-11-02 17:29:34.915333+07	10	f	\N	\N	unknown	\N	3	t	\N	Asia/Jakarta	\N
0415f9af-7dfb-453b-a938-1ea86ca33726	Win-Server-AD-5770	windows	\N	Data Center Virtual	Active Directory Domain Controller	7d02806ab1a64eda43d0707cbd8c09610a3bae42d5b1f6a4c5ad4cc15765590f	t	\N	2026-11-02 17:29:34.925064+07	10	f	\N	\N	unknown	\N	3	t	\N	Asia/Jakarta	\N
59baab7e-ba2d-4278-bc25-b213ae2b9000	Linux-Web-Prod-5770-Updated	linux	10.10.169.192	Cloud DMZ Singapore	Nginx reverse proxy & app server	8c3ed72e2afa59b806a859492a2b4581be0dcfcd67835c37ebcc75f4808e441c	t	\N	2026-11-02 17:29:34.934851+07	10	f	2026-11-08 06:59:52.799+07	f	unknown	\N	3	t	\N	Asia/Jakarta	\N
c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	CCTV NVR Gateway	linux	10.10.1.50	Kantor Cabang Barat — Operasional	[DEMO] Perekam kamera pos keamanan	46f8ffa21e10cf36001d86bf59ca2e4ef73b6ed431510d3acfc25a92aab3f41b	t	2026-11-10 08:03:21.359+07	2026-11-10 08:21:21.362354+07	10	t	2026-11-12 08:01:49.115+07	f	rto	2026-11-11 01:09:14.209+07	3	t	\N	Asia/Jakarta	\N
2069639d-cbdd-4d1c-90d7-b5421797ec06	Server App Windows ActiveDirectory	windows	10.250.1.15	Kantor Pusat — Data Center	[DEMO] Domain controller AD	46f8ffa21e10cf36001d86bf59ca2e4ef73b6ed431510d3acfc25a92aab3f41b	t	2026-11-10 07:46:21.359+07	2026-11-10 08:21:21.361204+07	10	t	2026-11-12 08:01:49.115+07	f	rto	2026-11-11 01:09:14.209+07	3	t	\N	Asia/Jakarta	\N
e8964be7-c02c-4cef-91d5-cd673ec76986	Switch Akses Cabang-Lt1	switch	10.10.1.2	Kantor Cabang Barat — Operasional	[DEMO] Switch akses user cabang	46f8ffa21e10cf36001d86bf59ca2e4ef73b6ed431510d3acfc25a92aab3f41b	t	2026-11-10 08:21:21.359+07	2026-11-10 08:21:21.361917+07	10	t	2026-11-12 08:01:49.115+07	f	rto	2026-11-11 01:09:14.209+07	3	t	\N	Asia/Jakarta	\N
\.


--
-- Data for Name: incidents; Type: TABLE DATA; Schema: public; Owner: yahyahidayatullah
--

COPY public.incidents (id, device_id, rule_key, severity, title, first_seen, last_seen, count, status, evidence, main_entity) FROM stdin;
46fbe7f8-eb8f-4280-b440-50b24f68a127	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	device_silent	high	Perangkat "CCTV NVR Gateway" Mengalami Ping RTO (Perangkat mati atau jaringan putus)	2026-11-10 08:03:21.359+07	2026-11-13 21:31:18.112+07	3232	open	[{"details": {"deviceId": "c1b343fb-8142-4cb2-a4c0-eae8140c7e7c", "deviceName": "CCTV NVR Gateway", "silentSince": "2026-11-10T01:03:21.359Z"}, "eventId": "silent_c1b343fb-8142-4cb2-a4c0-eae8140c7e7c", "message": "Perangkat CCTV NVR Gateway belum mengirim event log sejak 2026-11-10T01:03:21.359Z", "timestamp": "2026-11-10T15:03:33.511Z"}]	CCTV NVR Gateway
529229d4-edee-47a8-8fde-0b5e7aa2912e	2069639d-cbdd-4d1c-90d7-b5421797ec06	device_silent	high	Perangkat "Server App Windows ActiveDirectory" Mengalami Ping RTO (Perangkat mati atau jaringan putus)	2026-11-10 07:46:21.359+07	2026-11-13 21:31:18.112+07	3233	open	[{"details": {"deviceId": "2069639d-cbdd-4d1c-90d7-b5421797ec06", "deviceName": "Server App Windows ActiveDirectory", "silentSince": "2026-11-10T00:46:21.359Z"}, "eventId": "silent_2069639d-cbdd-4d1c-90d7-b5421797ec06", "message": "Perangkat Server App Windows ActiveDirectory belum mengirim event log sejak 2026-11-10T00:46:21.359Z", "timestamp": "2026-11-10T15:03:33.511Z"}]	Server App Windows ActiveDirectory
a9e8994f-dd51-4c1c-b998-2a4a3c5ff74a	58e4fedb-6b83-4e8c-8c9f-c12387a10217	device_silent	high	Perangkat "Server DB PostgreSQL Linux" Mengalami Ping RTO (Perangkat mati atau jaringan putus)	2026-11-10 08:21:21.359+07	2026-11-13 21:31:18.112+07	3233	open	[{"details": {"deviceId": "58e4fedb-6b83-4e8c-8c9f-c12387a10217", "deviceName": "Server DB PostgreSQL Linux", "silentSince": "2026-11-10T01:21:21.359Z"}, "eventId": "silent_58e4fedb-6b83-4e8c-8c9f-c12387a10217", "message": "Perangkat Server DB PostgreSQL Linux belum mengirim event log sejak 2026-11-10T01:21:21.359Z", "timestamp": "2026-11-10T15:03:33.511Z"}]	Server DB PostgreSQL Linux
433aa915-bb96-4579-b2ed-acb0059500b8	e02d1110-e2d1-4eff-902d-4ed057357b98	device_silent	high	Perangkat "Router Core CCR2004" Mengalami Ping RTO (Perangkat mati atau jaringan putus)	2026-11-10 08:21:21.359+07	2026-11-13 21:31:18.112+07	3233	open	[{"details": {"deviceId": "e02d1110-e2d1-4eff-902d-4ed057357b98", "deviceName": "Router Core CCR2004", "silentSince": "2026-11-10T01:21:21.359Z"}, "eventId": "silent_e02d1110-e2d1-4eff-902d-4ed057357b98", "message": "Perangkat Router Core CCR2004 belum mengirim event log sejak 2026-11-10T01:21:21.359Z", "timestamp": "2026-11-10T15:03:33.511Z"}]	Router Core CCR2004
6bf4fa61-8dbb-4702-8563-0758e2058b12	d2e142d2-8930-4e04-93ce-15ebad7103c3	device_silent	high	Perangkat "Switch Distribusi DC-1" Mengalami Ping RTO (Perangkat mati atau jaringan putus)	2026-11-10 08:21:21.359+07	2026-11-13 21:31:18.112+07	3233	open	[{"details": {"deviceId": "d2e142d2-8930-4e04-93ce-15ebad7103c3", "deviceName": "Switch Distribusi DC-1", "silentSince": "2026-11-10T01:21:21.359Z"}, "eventId": "silent_d2e142d2-8930-4e04-93ce-15ebad7103c3", "message": "Perangkat Switch Distribusi DC-1 belum mengirim event log sejak 2026-11-10T01:21:21.359Z", "timestamp": "2026-11-10T15:03:33.511Z"}]	Switch Distribusi DC-1
91c5e6c0-86a4-409c-acfa-779becaf2884	0415f9af-7dfb-453b-a938-1ea86ca33726	device_silent	medium	Perangkat "Win-Server-AD-5770" Berhenti Mengirim Log (> 15 Menit)	2026-11-02 17:29:34.925+07	2026-11-13 21:31:18.112+07	12384	open	[{"details": {"deviceId": "0415f9af-7dfb-453b-a938-1ea86ca33726", "deviceName": "Win-Server-AD-5770", "silentSince": "2026-11-02T10:29:34.925Z"}, "eventId": "silent_0415f9af-7dfb-453b-a938-1ea86ca33726", "message": "Perangkat Win-Server-AD-5770 belum mengirim event log sejak 2026-11-02T10:29:34.925Z", "timestamp": "2026-11-02T11:24:41.646Z"}]	Win-Server-AD-5770
4f91fcd1-437f-4b9c-8bd6-31c67028d5cc	59baab7e-ba2d-4278-bc25-b213ae2b9000	device_silent	medium	Perangkat "Linux-Web-Prod-5770-Updated" Berhenti Mengirim Log (> 15 Menit)	2026-11-02 17:29:34.934+07	2026-11-13 21:31:18.112+07	12384	open	[{"details": {"deviceId": "59baab7e-ba2d-4278-bc25-b213ae2b9000", "deviceName": "Linux-Web-Prod-5770-Updated", "silentSince": "2026-11-02T10:29:34.934Z"}, "eventId": "silent_59baab7e-ba2d-4278-bc25-b213ae2b9000", "message": "Perangkat Linux-Web-Prod-5770-Updated belum mengirim event log sejak 2026-11-02T10:29:34.934Z", "timestamp": "2026-11-02T11:24:41.646Z"}]	Linux-Web-Prod-5770-Updated
7ebe370a-fc3a-4175-9a1e-9ce5f8413142	e8964be7-c02c-4cef-91d5-cd673ec76986	device_silent	high	Perangkat "Switch Akses Cabang-Lt1" Mengalami Ping RTO (Perangkat mati atau jaringan putus)	2026-11-10 08:21:21.359+07	2026-11-13 21:31:18.112+07	3233	open	[{"details": {"deviceId": "e8964be7-c02c-4cef-91d5-cd673ec76986", "deviceName": "Switch Akses Cabang-Lt1", "silentSince": "2026-11-10T01:21:21.359Z"}, "eventId": "silent_e8964be7-c02c-4cef-91d5-cd673ec76986", "message": "Perangkat Switch Akses Cabang-Lt1 belum mengirim event log sejak 2026-11-10T01:21:21.359Z", "timestamp": "2026-11-10T15:03:33.511Z"}]	Switch Akses Cabang-Lt1
\.


--
-- Data for Name: log_events; Type: TABLE DATA; Schema: public; Owner: yahyahidayatullah
--

COPY public.log_events (id, device_id, received_at, event_time, severity, facility, source_app, category, message, raw, parsed, repeat_count, first_event_time) FROM stdin;
\.


--
-- Data for Name: log_filters; Type: TABLE DATA; Schema: public; Owner: yahyahidayatullah
--

COPY public.log_filters (id, device_id, name, match_type, pattern, action, is_active, match_count, last_matched_at, created_by, is_system_suggested, description, created_at, updated_at) FROM stdin;
d831cf94-4b64-4e59-892a-7c9d5a56d800	\N	Loop Fetch MikroTik — Download FINISHED	contains	Download from	merge	f	5	2026-11-13 21:31:17.834+07	system	t	Pola umum: MikroTik mengirim log "Download from <domain> FINISHED" berulang karena script /tool fetch berjalan terus-menerus. Aktifkan filter ini untuk menggabungkan pesan berulang.	2026-11-06 00:39:17.353005+07	2026-11-06 00:39:17.353005+07
69cff59f-e4e1-4090-b99f-d130e94cd0b2	\N	Loop Fetch MikroTik — Upload FINISHED	contains	Upload to	merge	f	5	2026-11-13 21:31:17.834+07	system	t	Pola umum: Loop fetch upload dari MikroTik. Gabungkan pesan berulang.	2026-11-06 00:39:17.353005+07	2026-11-06 00:39:17.353005+07
\.


--
-- Data for Name: log_top_patterns; Type: TABLE DATA; Schema: public; Owner: yahyahidayatullah
--

COPY public.log_top_patterns (id, device_id, hour_bucket, normalized_message, example_message, count, min_severity, max_severity, updated_at) FROM stdin;
\.


--
-- Data for Name: notification_channels; Type: TABLE DATA; Schema: public; Owner: yahyahidayatullah
--

COPY public.notification_channels (id, type, name, config, is_active, created_at, events) FROM stdin;
\.


--
-- Data for Name: notification_logs; Type: TABLE DATA; Schema: public; Owner: yahyahidayatullah
--

COPY public.notification_logs (id, channel_id, device_id, event_type, status, details, sent_at) FROM stdin;
\.


--
-- Data for Name: settings; Type: TABLE DATA; Schema: public; Owner: yahyahidayatullah
--

COPY public.settings (key, value, description, updated_at) FROM stdin;
log_retention_days	30	Jumlah hari penyimpanan event log sebelum dihapus otomatis	2026-11-02 17:00:30.853917+07
ip_allowlist	["127.0.0.1","::1"]	Daftar IP yang dikecualikan dari deteksi serangan (JSON array)	2026-11-02 17:00:30.856333+07
detection_thresholds	{"brute_force_login":{"max_failures":10,"window_minutes":5},"password_spray":{"max_users":5,"window_minutes":10},"success_after_failures":{"min_failures":5},"port_scan":{"min_ports":20,"window_minutes":1},"device_silent_minutes":15,"log_burst_multiplier":5}	Ambang batas aturan deteksi serangan	2026-11-02 17:00:30.86011+07
ai_analysis_hourly_limit	20	Maksimal pemanggilan analisa AI per jam	2026-11-02 17:00:30.861255+07
\.


--
-- Data for Name: topology_links; Type: TABLE DATA; Schema: public; Owner: yahyahidayatullah
--

COPY public.topology_links (id, map_id, source_node_id, target_node_id, label, tipe, is_demo, created_at) FROM stdin;
5b956903-ead9-485a-828f-8bb704a69e3a	3caf2fc3-7165-40c0-8c1c-b605bee7b2d8	b9ef4fdf-3eb7-4793-a1e9-0b2e529b70b5	bb07cbae-dd9b-458f-9fdc-0bd792c7d718	BGP Peering	kabel	t	2026-11-10 08:21:21.366141+07
c2e0a653-6563-4803-b382-4bb299fff051	3caf2fc3-7165-40c0-8c1c-b605bee7b2d8	bb07cbae-dd9b-458f-9fdc-0bd792c7d718	2c475b38-0411-4d6c-b91c-5914ed2d1026	Fiber 500M	kabel	t	2026-11-10 08:21:21.366141+07
a13a476a-8523-4e24-ac15-ba6edb6c198d	3caf2fc3-7165-40c0-8c1c-b605bee7b2d8	2c475b38-0411-4d6c-b91c-5914ed2d1026	f9fe6e60-1291-4f31-980f-ee17ae618bc9	Trunk 10G	kabel	t	2026-11-10 08:21:21.366141+07
c95173fb-def3-4d29-9057-ac6e2d010671	3caf2fc3-7165-40c0-8c1c-b605bee7b2d8	f9fe6e60-1291-4f31-980f-ee17ae618bc9	e585e5a4-0b4b-4586-9b09-4dfd45afe674	VLAN 100	kabel	t	2026-11-10 08:21:21.366141+07
4dba7a71-55c9-4c0d-89eb-8dd8c747dc56	3caf2fc3-7165-40c0-8c1c-b605bee7b2d8	f9fe6e60-1291-4f31-980f-ee17ae618bc9	67f03953-fe5f-4850-a2d9-624be8fbbb8b	VLAN 200	kabel	t	2026-11-10 08:21:21.366141+07
879859e2-5081-4fc1-b5a5-e95850748ebf	3caf2fc3-7165-40c0-8c1c-b605bee7b2d8	2c475b38-0411-4d6c-b91c-5914ed2d1026	c017a1cc-23ab-467f-a56f-0528010ba33e	IPSec VPN 100M	vpn	t	2026-11-10 08:21:21.366141+07
167401a8-ac19-495e-8cdf-df250f897532	3caf2fc3-7165-40c0-8c1c-b605bee7b2d8	c017a1cc-23ab-467f-a56f-0528010ba33e	6524c572-86fa-46be-aba0-a53802f194b3	PoE GbE	kabel	t	2026-11-10 08:21:21.366141+07
\.


--
-- Data for Name: topology_maps; Type: TABLE DATA; Schema: public; Owner: yahyahidayatullah
--

COPY public.topology_maps (id, nama, is_default, is_demo, created_at) FROM stdin;
bd4d78aa-ee58-4051-b0cf-df8914dbd38f	Peta Jaringan Utama	t	f	2026-11-10 08:03:42.49611+07
3caf2fc3-7165-40c0-8c1c-b605bee7b2d8	Peta Jaringan Multi-Cabang (Demo)	f	t	2026-11-10 08:21:21.356307+07
\.


--
-- Data for Name: topology_nodes; Type: TABLE DATA; Schema: public; Owner: yahyahidayatullah
--

COPY public.topology_nodes (id, map_id, device_id, tipe_virtual, label, x, y, terkunci, is_demo, created_at, updated_at) FROM stdin;
b9ef4fdf-3eb7-4793-a1e9-0b2e529b70b5	3caf2fc3-7165-40c0-8c1c-b605bee7b2d8	\N	internet	Internet Gateway Global	480	40	f	t	2026-11-10 08:21:21.362764+07	2026-11-10 20:53:27.866959+07
bb07cbae-dd9b-458f-9fdc-0bd792c7d718	3caf2fc3-7165-40c0-8c1c-b605bee7b2d8	\N	isp	ISP Telkom Metro-E 500M	480	150	f	t	2026-11-10 08:21:21.363234+07	2026-11-10 20:53:27.866959+07
2c475b38-0411-4d6c-b91c-5914ed2d1026	3caf2fc3-7165-40c0-8c1c-b605bee7b2d8	e02d1110-e2d1-4eff-902d-4ed057357b98	\N	\N	230	330	f	t	2026-11-10 08:21:21.363613+07	2026-11-10 20:53:27.866959+07
f9fe6e60-1291-4f31-980f-ee17ae618bc9	3caf2fc3-7165-40c0-8c1c-b605bee7b2d8	d2e142d2-8930-4e04-93ce-15ebad7103c3	\N	\N	230	450	f	t	2026-11-10 08:21:21.364028+07	2026-11-10 20:53:27.866959+07
67f03953-fe5f-4850-a2d9-624be8fbbb8b	3caf2fc3-7165-40c0-8c1c-b605bee7b2d8	2069639d-cbdd-4d1c-90d7-b5421797ec06	\N	\N	380	530	f	t	2026-11-10 08:21:21.364891+07	2026-11-10 20:53:27.866959+07
c017a1cc-23ab-467f-a56f-0528010ba33e	3caf2fc3-7165-40c0-8c1c-b605bee7b2d8	e8964be7-c02c-4cef-91d5-cd673ec76986	\N	\N	750	360	f	t	2026-11-10 08:21:21.36529+07	2026-11-10 20:53:27.866959+07
6524c572-86fa-46be-aba0-a53802f194b3	3caf2fc3-7165-40c0-8c1c-b605bee7b2d8	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	\N	\N	880	480	f	t	2026-11-10 08:21:21.365635+07	2026-11-10 20:53:27.866959+07
e585e5a4-0b4b-4586-9b09-4dfd45afe674	3caf2fc3-7165-40c0-8c1c-b605bee7b2d8	58e4fedb-6b83-4e8c-8c9f-c12387a10217	\N	\N	400	300	f	t	2026-11-10 08:21:21.364395+07	2026-11-12 07:52:19.617+07
673a856e-4f3d-4395-bdba-3938c79e012e	bd4d78aa-ee58-4051-b0cf-df8914dbd38f	58e4fedb-6b83-4e8c-8c9f-c12387a10217	\N	\N	400	300	f	f	2026-11-11 10:49:17.232342+07	2026-11-12 07:52:19.617+07
ea72425a-8239-4b97-8506-8aecbe9e76e7	bd4d78aa-ee58-4051-b0cf-df8914dbd38f	d2e142d2-8930-4e04-93ce-15ebad7103c3	\N	\N	780	260	f	f	2026-11-11 10:49:17.233943+07	2026-11-11 10:49:42.897+07
9c1fd30b-a6c7-43d3-b501-3fd16170f71d	bd4d78aa-ee58-4051-b0cf-df8914dbd38f	0415f9af-7dfb-453b-a938-1ea86ca33726	\N	\N	1020	260	f	f	2026-11-11 10:49:17.234708+07	2026-11-11 10:49:42.897+07
7300e82e-83a1-4af2-82c6-3995477f4801	bd4d78aa-ee58-4051-b0cf-df8914dbd38f	e02d1110-e2d1-4eff-902d-4ed057357b98	\N	\N	780	100	f	f	2026-11-11 10:49:17.230361+07	2026-11-11 10:49:42.897+07
bbb3e51c-5cd0-4cf7-8835-51d8dfb708ba	bd4d78aa-ee58-4051-b0cf-df8914dbd38f	e8964be7-c02c-4cef-91d5-cd673ec76986	\N	\N	540	260	f	f	2026-11-11 10:49:17.233163+07	2026-11-11 10:49:42.897+07
0f655335-1038-4b43-94b0-3de70f9c850a	bd4d78aa-ee58-4051-b0cf-df8914dbd38f	c1b343fb-8142-4cb2-a4c0-eae8140c7e7c	\N	\N	260	202	f	f	2026-11-11 10:27:21.333806+07	2026-11-11 10:49:42.897+07
add7580a-5817-41b9-808c-f6fd35262454	bd4d78aa-ee58-4051-b0cf-df8914dbd38f	2069639d-cbdd-4d1c-90d7-b5421797ec06	\N	\N	1020	100	f	f	2026-11-11 10:49:17.231533+07	2026-11-11 10:49:42.897+07
ec773786-1606-46f0-b08c-230c386781fc	bd4d78aa-ee58-4051-b0cf-df8914dbd38f	\N	cloud	Cloud Node Uji	-113	166	f	f	2026-11-11 00:45:40.703367+07	2026-11-11 10:49:42.897+07
f6725398-bc96-4043-b454-0adc2ea13092	bd4d78aa-ee58-4051-b0cf-df8914dbd38f	59baab7e-ba2d-4278-bc25-b213ae2b9000	\N	\N	400	300	f	f	2026-11-11 10:49:17.053353+07	2026-11-12 07:10:03.531+07
\.


--
-- Data for Name: user_map_view_states; Type: TABLE DATA; Schema: public; Owner: yahyahidayatullah
--

COPY public.user_map_view_states (id, user_id, map_id, collapsed_group_ids, updated_at) FROM stdin;
e06f5bf7-2654-48be-941f-46bd42d789ce	a96ddf36-d585-4437-9836-68df85d801de	bd4d78aa-ee58-4051-b0cf-df8914dbd38f	["252dfe03-6b26-4883-99dc-96b2e9b505c2"]	2026-11-11 16:33:00.86714+07
e18c64cf-093a-405f-87f0-bd093fe25042	31b4e305-5d72-4632-9312-97980d88d5cf	bd4d78aa-ee58-4051-b0cf-df8914dbd38f	["252dfe03-6b26-4883-99dc-96b2e9b505c2"]	2026-11-11 16:33:00.933+07
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: yahyahidayatullah
--

COPY public.users (id, username, password_hash, role, is_active, must_change_password, created_at) FROM stdin;
31b4e305-5d72-4632-9312-97980d88d5cf	operator_4412	$argon2id$v=19$m=19456,t=2,p=1$ThMnsEffqJmDcGuajXXVWA$0vIEN8RYadIyEP1RXYPYE1A5JDhhd//A4bTM1I3Gor8	viewer	t	t	2026-11-02 17:22:38.689931+07
a96ddf36-d585-4437-9836-68df85d801de	admin	$argon2id$v=19$m=19456,t=2,p=1$qwk0gd71oLLCtTOyjpQjMA$vIjfCCPsebwAKW3qbgWXNfydQUIVN3ab917LbZZZhO0	admin	t	f	2026-11-02 17:00:30.851612+07
184eb104-9059-4bbf-a295-fbd3101b8075	test_viewer_verify	$argon2id$v=19$m=19456,t=2,p=1$Mfd4AcXAbQ8UPhKN39o5TQ$SL7xEcLYsef/vGH9/nlny7PUIr+Cic+Fp631Dek8KQ0	viewer	t	f	2026-11-08 17:58:28.741159+07
\.


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE SET; Schema: drizzle; Owner: yahyahidayatullah
--

SELECT pg_catalog.setval('drizzle.__drizzle_migrations_id_seq', 9, true);


--
-- Name: log_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: yahyahidayatullah
--

SELECT pg_catalog.setval('public.log_events_id_seq', 254626, true);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: yahyahidayatullah
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: ai_analyses ai_analyses_pkey; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.ai_analyses
    ADD CONSTRAINT ai_analyses_pkey PRIMARY KEY (id);


--
-- Name: client_errors client_errors_pkey; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.client_errors
    ADD CONSTRAINT client_errors_pkey PRIMARY KEY (id);


--
-- Name: device_groups device_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.device_groups
    ADD CONSTRAINT device_groups_pkey PRIMARY KEY (id);


--
-- Name: device_log_hourly device_log_hourly_pkey; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.device_log_hourly
    ADD CONSTRAINT device_log_hourly_pkey PRIMARY KEY (id);


--
-- Name: device_ping_hourly device_ping_hourly_pkey; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.device_ping_hourly
    ADD CONSTRAINT device_ping_hourly_pkey PRIMARY KEY (id);


--
-- Name: device_status_history device_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.device_status_history
    ADD CONSTRAINT device_status_history_pkey PRIMARY KEY (id);


--
-- Name: devices devices_ip_address_unique; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_ip_address_unique UNIQUE (ip_address);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: incidents incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_pkey PRIMARY KEY (id);


--
-- Name: log_events log_events_pkey; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.log_events
    ADD CONSTRAINT log_events_pkey PRIMARY KEY (id);


--
-- Name: log_filters log_filters_pkey; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.log_filters
    ADD CONSTRAINT log_filters_pkey PRIMARY KEY (id);


--
-- Name: log_top_patterns log_top_patterns_pkey; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.log_top_patterns
    ADD CONSTRAINT log_top_patterns_pkey PRIMARY KEY (id);


--
-- Name: notification_channels notification_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.notification_channels
    ADD CONSTRAINT notification_channels_pkey PRIMARY KEY (id);


--
-- Name: notification_logs notification_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT notification_logs_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: topology_links topology_links_pkey; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.topology_links
    ADD CONSTRAINT topology_links_pkey PRIMARY KEY (id);


--
-- Name: topology_maps topology_maps_pkey; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.topology_maps
    ADD CONSTRAINT topology_maps_pkey PRIMARY KEY (id);


--
-- Name: topology_nodes topology_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.topology_nodes
    ADD CONSTRAINT topology_nodes_pkey PRIMARY KEY (id);


--
-- Name: topology_links uq_topology_links_source_target; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.topology_links
    ADD CONSTRAINT uq_topology_links_source_target UNIQUE (source_node_id, target_node_id);


--
-- Name: user_map_view_states user_map_view_states_pkey; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.user_map_view_states
    ADD CONSTRAINT user_map_view_states_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_unique; Type: CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_unique UNIQUE (username);


--
-- Name: idx_client_errors_status; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_client_errors_status ON public.client_errors USING btree (status);


--
-- Name: idx_client_errors_terakhir; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_client_errors_terakhir ON public.client_errors USING btree (terakhir_terjadi);


--
-- Name: idx_client_errors_waktu; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_client_errors_waktu ON public.client_errors USING btree (waktu);


--
-- Name: idx_dev_log_hourly_dev_hour; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_dev_log_hourly_dev_hour ON public.device_log_hourly USING btree (device_id, hour_bucket DESC);


--
-- Name: idx_dev_log_hourly_hour; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_dev_log_hourly_hour ON public.device_log_hourly USING btree (hour_bucket DESC);


--
-- Name: idx_dev_ping_hourly_dev_hour; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_dev_ping_hourly_dev_hour ON public.device_ping_hourly USING btree (device_id, hour_bucket DESC);


--
-- Name: idx_dev_status_hist_dev_time; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_dev_status_hist_dev_time ON public.device_status_history USING btree (device_id, started_at DESC NULLS LAST);


--
-- Name: idx_device_groups_lower_nama; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE UNIQUE INDEX idx_device_groups_lower_nama ON public.device_groups USING btree (lower((nama)::text));


--
-- Name: idx_device_groups_lower_trim_nama; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE UNIQUE INDEX idx_device_groups_lower_trim_nama ON public.device_groups USING btree (lower(TRIM(BOTH FROM nama)));


--
-- Name: idx_device_groups_parent_id; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_device_groups_parent_id ON public.device_groups USING btree (parent_id);


--
-- Name: idx_devices_group_id; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_devices_group_id ON public.devices USING btree (group_id);


--
-- Name: idx_incidents_device_status; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_incidents_device_status ON public.incidents USING btree (device_id, status);


--
-- Name: idx_incidents_rule_device; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_incidents_rule_device ON public.incidents USING btree (device_id, rule_key, main_entity);


--
-- Name: idx_log_events_actor; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_log_events_actor ON public.log_events USING btree (device_id, ((parsed ->> 'actor'::text))) WHERE ((parsed ->> 'actor'::text) IS NOT NULL);


--
-- Name: idx_log_events_device_sev_time; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_log_events_device_sev_time ON public.log_events USING btree (device_id, severity, event_time DESC NULLS LAST);


--
-- Name: idx_log_events_device_time; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_log_events_device_time ON public.log_events USING btree (device_id, event_time DESC NULLS LAST);


--
-- Name: idx_log_events_device_time_id; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_log_events_device_time_id ON public.log_events USING btree (device_id, event_time DESC NULLS LAST, id DESC NULLS LAST);


--
-- Name: idx_log_events_device_time_id_asc; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_log_events_device_time_id_asc ON public.log_events USING btree (device_id, event_time, id);


--
-- Name: idx_log_events_message_trgm; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_log_events_message_trgm ON public.log_events USING gin (message public.gin_trgm_ops);


--
-- Name: idx_log_events_src_ip; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_log_events_src_ip ON public.log_events USING btree (device_id, ((parsed ->> 'src_ip'::text))) WHERE ((parsed ->> 'src_ip'::text) IS NOT NULL);


--
-- Name: idx_log_events_time; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_log_events_time ON public.log_events USING btree (event_time DESC);


--
-- Name: idx_log_filters_active; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_log_filters_active ON public.log_filters USING btree (is_active);


--
-- Name: idx_log_filters_device_active; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_log_filters_device_active ON public.log_filters USING btree (device_id, is_active);


--
-- Name: idx_log_top_patterns_device_hour; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_log_top_patterns_device_hour ON public.log_top_patterns USING btree (device_id, hour_bucket DESC);


--
-- Name: idx_notif_logs_channel_time; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_notif_logs_channel_time ON public.notification_logs USING btree (channel_id, sent_at DESC NULLS LAST);


--
-- Name: idx_notif_logs_device_time; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_notif_logs_device_time ON public.notification_logs USING btree (device_id, sent_at DESC NULLS LAST);


--
-- Name: idx_topology_links_map_id; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_topology_links_map_id ON public.topology_links USING btree (map_id);


--
-- Name: idx_topology_links_source; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_topology_links_source ON public.topology_links USING btree (source_node_id);


--
-- Name: idx_topology_links_target; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_topology_links_target ON public.topology_links USING btree (target_node_id);


--
-- Name: idx_topology_nodes_map_device; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE UNIQUE INDEX idx_topology_nodes_map_device ON public.topology_nodes USING btree (map_id, device_id) WHERE (device_id IS NOT NULL);


--
-- Name: idx_topology_nodes_map_id; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_topology_nodes_map_id ON public.topology_nodes USING btree (map_id);


--
-- Name: idx_user_map_view_states_user_map; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE INDEX idx_user_map_view_states_user_map ON public.user_map_view_states USING btree (user_id, map_id);


--
-- Name: uq_client_errors_sidik_jari; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE UNIQUE INDEX uq_client_errors_sidik_jari ON public.client_errors USING btree (sidik_jari);


--
-- Name: uq_dev_log_hourly_dev_hour; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE UNIQUE INDEX uq_dev_log_hourly_dev_hour ON public.device_log_hourly USING btree (device_id, hour_bucket);


--
-- Name: uq_dev_ping_hourly_dev_hour; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE UNIQUE INDEX uq_dev_ping_hourly_dev_hour ON public.device_ping_hourly USING btree (device_id, hour_bucket);


--
-- Name: uq_log_top_patterns_device_hour_msg; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE UNIQUE INDEX uq_log_top_patterns_device_hour_msg ON public.log_top_patterns USING btree (device_id, hour_bucket, normalized_message);


--
-- Name: uq_user_map_view_states_user_map; Type: INDEX; Schema: public; Owner: yahyahidayatullah
--

CREATE UNIQUE INDEX uq_user_map_view_states_user_map ON public.user_map_view_states USING btree (user_id, map_id);


--
-- Name: ai_analyses ai_analyses_device_id_devices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.ai_analyses
    ADD CONSTRAINT ai_analyses_device_id_devices_id_fk FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: ai_analyses ai_analyses_incident_id_incidents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.ai_analyses
    ADD CONSTRAINT ai_analyses_incident_id_incidents_id_fk FOREIGN KEY (incident_id) REFERENCES public.incidents(id) ON DELETE SET NULL;


--
-- Name: client_errors client_errors_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.client_errors
    ADD CONSTRAINT client_errors_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: device_groups device_groups_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.device_groups
    ADD CONSTRAINT device_groups_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.device_groups(id) ON DELETE SET NULL;


--
-- Name: device_log_hourly device_log_hourly_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.device_log_hourly
    ADD CONSTRAINT device_log_hourly_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: device_ping_hourly device_ping_hourly_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.device_ping_hourly
    ADD CONSTRAINT device_ping_hourly_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: device_status_history device_status_history_device_id_devices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.device_status_history
    ADD CONSTRAINT device_status_history_device_id_devices_id_fk FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: devices devices_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.device_groups(id) ON DELETE SET NULL;


--
-- Name: incidents incidents_device_id_devices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_device_id_devices_id_fk FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: log_events log_events_device_id_devices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.log_events
    ADD CONSTRAINT log_events_device_id_devices_id_fk FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: log_filters log_filters_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.log_filters
    ADD CONSTRAINT log_filters_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: log_top_patterns log_top_patterns_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.log_top_patterns
    ADD CONSTRAINT log_top_patterns_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: notification_logs notification_logs_channel_id_notification_channels_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT notification_logs_channel_id_notification_channels_id_fk FOREIGN KEY (channel_id) REFERENCES public.notification_channels(id) ON DELETE SET NULL;


--
-- Name: notification_logs notification_logs_device_id_devices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT notification_logs_device_id_devices_id_fk FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: topology_links topology_links_map_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.topology_links
    ADD CONSTRAINT topology_links_map_id_fkey FOREIGN KEY (map_id) REFERENCES public.topology_maps(id) ON DELETE CASCADE;


--
-- Name: topology_links topology_links_source_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.topology_links
    ADD CONSTRAINT topology_links_source_node_id_fkey FOREIGN KEY (source_node_id) REFERENCES public.topology_nodes(id) ON DELETE CASCADE;


--
-- Name: topology_links topology_links_target_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.topology_links
    ADD CONSTRAINT topology_links_target_node_id_fkey FOREIGN KEY (target_node_id) REFERENCES public.topology_nodes(id) ON DELETE CASCADE;


--
-- Name: topology_nodes topology_nodes_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.topology_nodes
    ADD CONSTRAINT topology_nodes_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: topology_nodes topology_nodes_map_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.topology_nodes
    ADD CONSTRAINT topology_nodes_map_id_fkey FOREIGN KEY (map_id) REFERENCES public.topology_maps(id) ON DELETE CASCADE;


--
-- Name: user_map_view_states user_map_view_states_map_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.user_map_view_states
    ADD CONSTRAINT user_map_view_states_map_id_fkey FOREIGN KEY (map_id) REFERENCES public.topology_maps(id) ON DELETE CASCADE;


--
-- Name: user_map_view_states user_map_view_states_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: yahyahidayatullah
--

ALTER TABLE ONLY public.user_map_view_states
    ADD CONSTRAINT user_map_view_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict XG20RzVXyyux8nzGR1711JxVAnQG1Ouh14ecLSGVsL6svMFXMRwRQHO8klKYnx7


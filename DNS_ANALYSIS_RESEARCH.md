# DNS Analysis Research & Best Practices

This document summarizes research into best practices for DNS analysis in PCAP tools (Wireshark, Zeek, Brim, NetworkMiner) and outlines features for a "best-in-class" DNS analysis UI.

## 1. Key Metrics and Visualizations

Effective DNS analysis requires visualizing both the volume and the nature of the traffic.

*   **Traffic Volume & Timeline:**
    *   **Queries over Time:** Line chart showing the rate of DNS queries (QPS). Spikes can indicate scanning, tunneling, or DDoS.
    *   **Response Time:** (If calculable) Average latency between query and response.
*   **Top Lists (The "Top N"):**
    *   **Top Queried Domains:** Identify the most popular destinations.
    *   **Top Clients (Source IPs):** Identify which machines are generating the most DNS traffic.
    *   **Top DNS Servers:** Identify which servers are being queried (internal vs. external).
*   **Distributions:**
    *   **Query Types (QTYPE):** Pie/Bar chart of A, AAAA, PTR, TXT, MX, etc.
        *   *Insight:* High volume of `TXT` or `NULL` records is often suspicious (tunneling).
    *   **Response Codes (RCODE):** Breakdown of NOERROR, NXDOMAIN, SERVFAIL, REFUSED.
        *   *Insight:* High `NXDOMAIN` % suggests DGA malware or misconfiguration.

## 2. Security-Relevant Indicators

A security-focused UI should highlight these specific anomalies:

*   **DGA (Domain Generation Algorithms):**
    *   **Indicator:** High rate of `NXDOMAIN` responses.
    *   **Indicator:** Queries with high entropy (randomness) in the domain name (e.g., `xkqzpj.com`).
    *   **Feature:** "Suspicious Domains" list based on entropy scoring.
*   **DNS Tunneling & Exfiltration:**
    *   **Indicator:** Unusually long query names (subdomains carrying payload).
    *   **Indicator:** High volume of `TXT`, `CNAME`, or `NULL` records with large response sizes.
    *   **Indicator:** High entropy in the subdomain part of the query.
    *   **Feature:** Scatter plot of Query Length vs. Entropy.
*   **Fast Flux & C2:**
    *   **Indicator:** Very short TTLs (Time To Live) for A records (e.g., < 300s).
    *   **Indicator:** Single domain resolving to many different IPs over a short time.
    *   **Feature:** "Rare Domains" view (domains seen only once or twice).

## 3. User Interface Design for Exploration

The UI should facilitate a workflow of "Overview -> Anomaly Detection -> Drill-down".

*   **Dashboard View:**
    *   Summary cards: Total Queries, Unique Domains, % Errors (NXDOMAIN).
    *   Sparklines for traffic trends.
*   **Interactive Data Grid:**
    *   Columns: Timestamp, Client IP, Server IP, Query, Type, RCode, Answers, TTL.
    *   **Smart Filtering:** One-click filters for "Show Errors", "Show Non-A/AAAA Records", "Show Long Queries".
    *   **Context Actions:** Right-click to "Filter by this Client", "Whois Lookup", "Passive DNS Lookup" (external integration).
*   **Visual Correlation:**
    *   **Sankey Diagram:** Visualizing flow from Client IP -> DNS Server -> Top Domains.
    *   **Timeline Zoom:** Select a spike in the timeline to filter the data grid to that time range.

## 4. Useful Fields & Aggregations

To support the above, the backend needs to provide these specific data points:

*   **Raw Fields:**
    *   `query` (The domain name)
    *   `qtype_name` (A, AAAA, TXT...)
    *   `rcode_name` (NOERROR, NXDOMAIN...)
    *   `answers` (The resolved IPs or data)
    *   `TTLs` (Time To Live values)
    *   `id_orig_h` (Client IP)
    *   `id_resp_h` (Server IP)
*   **Computed/Aggregated Fields:**
    *   `query_length`: Length of the query string (useful for tunneling detection).
    *   `entropy`: Shannon entropy of the query string (useful for DGA/tunneling).
    *   `answer_count`: Number of IPs returned in a response.
    *   `is_suspicious`: Boolean flag based on heuristics (e.g., high entropy + NXDOMAIN).

## 5. Summary of Features to Implement

Based on this research, here is the roadmap for the "Best & Comfortable UI" DNS Tab:

1.  **DNS Overview Dashboard:**
    *   Metrics: Total Queries, Unique Domains, Failed Queries (%).
    *   Charts: Query Volume (Time Series), Top 10 Domains (Bar), QTYPE Distribution (Donut), RCODE Distribution (Donut).
2.  **Advanced "Security" View:**
    *   **DGA Detector:** Table of domains with high entropy or high NXDOMAIN count.
    *   **Tunneling Detector:** List of queries with length > 50 chars or high TXT record usage.
    *   **Rare Domains:** List of domains queried < 3 times in the capture.
3.  **Detailed Log Explorer:**
    *   Searchable/Sortable table with all raw DNS fields.
    *   "Quick Filters" sidebar (e.g., "Errors Only", "TXT Records", "High Entropy").
    *   Detail view showing full answer section and TTLs.

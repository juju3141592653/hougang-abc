// Page frame: header with "New search" (common navigation: public pages -> S1) and a footer showing
// when the data was last updated (UC-4.10 step 5) and its source.
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { api } from "../api/client.js";
import { formatDateTime, formatMonth } from "./format.js";

export default function Layout() {
  const [dataInfo, setDataInfo] = useState(null);

  useEffect(() => {
    api.lastUpdated().then(setDataInfo).catch(() => setDataInfo(null));
  }, []);

  return (
    <div className="app">
      <header className="site-header">
        <div className="site-header-inner">
          <Link to="/" className="brand" aria-label="Hougang ABC home">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" width="28" height="28">
                <rect width="32" height="32" rx="7" fill="currentColor" />
                <path d="M8 24V12l8-5 8 5v12h-5v-7h-6v7z" fill="#fff" />
              </svg>
            </span>
            <span>
              Hougang <strong>ABC</strong>
            </span>
          </Link>
          <nav aria-label="Main">
            <NavLink to="/" end>
              New search
            </NavLink>
          </nav>
        </div>
      </header>
      <main id="main">
        <Outlet />
      </main>
      <footer className="site-footer">
        <p>
          Data: HDB resale flat prices (Jan 2017 onwards) from{" "}
          <a href="https://data.gov.sg" target="_blank" rel="noreferrer">
            data.gov.sg
          </a>
          , Singapore Open Data Licence.
          {dataInfo?.latest_month && <> Latest month: {formatMonth(dataInfo.latest_month)}.</>}
          {dataInfo?.last_successful_update && <> Last updated {formatDateTime(dataInfo.last_successful_update)}.</>}
        </p>
        <p>
          Estimates are statistical and not official valuations. <Link to="/admin">Admin</Link>
        </p>
      </footer>
    </div>
  );
}

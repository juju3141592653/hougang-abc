// Page frame. Header: logo -> S1, "Search" -> S1 (common navigation: new search from any public
// page), "Price estimate" -> S5 (decisions #28). Footer: data source and when the data was last
// updated (UC-4.10 step 5), the estimate disclaimer (SRS 5.2) and the admin entry (-> S7).
import { Calculator, Home, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { api } from "../api/client.js";
import { formatCount, formatDateTime, formatMonth } from "./format.js";

export default function Layout() {
  const [dataInfo, setDataInfo] = useState(null);
  const location = useLocation();
  const isAdmin = location.pathname.startsWith("/admin");
  // "Search" stays highlighted through the whole search flow (S1, S2, S2a, S3, S4).
  const inSearch = location.pathname === "/" || /^\/(results|history|summary)(\/|$)/.test(location.pathname);

  useEffect(() => {
    api.lastUpdated().then(setDataInfo).catch(() => setDataInfo(null));
  }, []);

  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [location.pathname]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="container site-header-inner">
          <Link to="/" className="brand" aria-label="Hougang ABC home">
            <span className="brand-mark" aria-hidden="true">
              <Home size={17} strokeWidth={2.4} />
            </span>
            <span className="brand-name">
              Hougang ABC <span>· HDB resale prices</span>
            </span>
          </Link>
          {!isAdmin && (
            <nav className="main-nav" aria-label="Main">
              <NavLink to="/" end className={inSearch ? "active" : undefined}>
                <Search size={16} aria-hidden="true" />
                <span className="nav-label">Search</span>
              </NavLink>
              <NavLink to="/predict">
                <Calculator size={16} aria-hidden="true" />
                <span className="nav-label">Price estimate</span>
              </NavLink>
            </nav>
          )}
          {dataInfo?.latest_month && (
            <span className="header-status" title={`Last updated ${formatDateTime(dataInfo.last_successful_update)}`}>
              <span className="status-dot" aria-hidden="true" />
              Data to {formatMonth(dataInfo.latest_month)}
            </span>
          )}
        </div>
      </header>
      <main id="main">
        <Outlet context={{ dataInfo }} />
      </main>
      <footer className="site-footer">
        <div className="container site-footer-inner">
          <div>
            <h4>Hougang ABC</h4>
            <p>
              HDB resale prices, trends and fair-price estimates for every town in Singapore, built on official resale
              transactions.
            </p>
          </div>
          <div>
            <h4>Data</h4>
            <p>
              HDB resale flat prices (Jan 2017 onwards),{" "}
              <a href="https://data.gov.sg" target="_blank" rel="noreferrer">
                data.gov.sg
              </a>
              , Singapore Open Data Licence.
            </p>
            {dataInfo?.latest_month && (
              <p>
                {formatCount(dataInfo.total_rows)} transactions, {formatMonth(dataInfo.first_month)} –{" "}
                {formatMonth(dataInfo.latest_month)}. Last updated {formatDateTime(dataInfo.last_successful_update)}.
              </p>
            )}
          </div>
          <div>
            <h4>About the estimates</h4>
            <p>
              Estimates come from a statistical model of recent sales. They are not official valuations or financial
              advice.
            </p>
            <p>
              <Link to="/admin">Administrator sign in</Link>
            </p>
          </div>
        </div>
        <div className="container footer-legal">SC2006 Software Engineering · Group 2</div>
      </footer>
    </div>
  );
}

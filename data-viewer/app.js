/**
 * EcoTrack / Nexus Multipage Data Viewer & Dashboard SPA
 * Built with Pure Vanilla JavaScript, SWR Caching & Zero Reloads
 */

import { MockAPI } from './mock-data.js';
import { swr } from './swr-cache.js';

// DOM Element Selectors
const appRoot = document.getElementById('view-container');
const navItems = document.querySelectorAll('.nav-item');
const syncIndicator = document.getElementById('sync-indicator');
const syncText = document.getElementById('sync-text');
const liveClock = document.getElementById('live-clock');
const toastContainer = document.getElementById('toast-container');
const detailDrawer = document.getElementById('detail-drawer');
const drawerContent = document.getElementById('drawer-content');
const drawerOverlay = document.getElementById('drawer-overlay');
const closeDrawerBtn = document.getElementById('close-drawer-btn');

// App Global State
let currentRoute = 'overview';
let activeFilters = {
  telemetryRoom: 'all',
  telemetrySearch: '',
  maintenanceStatus: 'all',
  analyticsRange: '7D',
};

// Clock updater
function updateClock() {
  const now = new Date();
  if (liveClock) {
    liveClock.textContent = now.toLocaleTimeString('en-US', { hour12: false });
  }
}
setInterval(updateClock, 1000);
updateClock();

// Listen to SWR background revalidation activity for non-intrusive micro beacon
swr.onActivityChange((isRevalidating) => {
  if (syncIndicator && syncText) {
    if (isRevalidating) {
      syncIndicator.classList.add('syncing');
      syncText.textContent = 'Syncing...';
    } else {
      syncIndicator.classList.remove('syncing');
      syncText.textContent = 'Live SWR Cached';
    }
  }
});

// Toast notification helper (non-blocking micro notification)
export function showToast(title, message, type = 'info') {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-indicator"></div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${message}</div>
    </div>
  `;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Global Drawer Controls
export function openDrawer(htmlContent) {
  if (drawerContent && detailDrawer && drawerOverlay) {
    drawerContent.innerHTML = htmlContent;
    detailDrawer.classList.add('open');
    drawerOverlay.classList.add('open');
  }
}

export function closeDrawer() {
  if (detailDrawer && drawerOverlay) {
    detailDrawer.classList.remove('open');
    drawerOverlay.classList.remove('open');
  }
}

if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', closeDrawer);
if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawer);

// =============================================================================
// ROUTER & VIEW CONTROLLERS (Zero Page Reloads)
// =============================================================================

function navigateTo(route) {
  if (currentRoute === route && document.querySelector('.page-view')) {
    // If clicking current route, trigger background revalidation without clearing UI
    refreshCurrentRoute();
    return;
  }

  currentRoute = route;
  window.location.hash = `#${route}`;

  // Update Navigation Bar
  navItems.forEach(item => {
    if (item.dataset.route === route) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Render view seamlessly
  renderRoute(route);
}

window.addEventListener('hashchange', () => {
  const hashRoute = window.location.hash.replace('#', '') || 'overview';
  if (hashRoute !== currentRoute) {
    navigateTo(hashRoute);
  }
});

// Navigation Click Handlers
navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const route = item.dataset.route;
    if (route) navigateTo(route);
  });
});

// =============================================================================
// VIEW RENDERERS (With SWR Stale-While-Revalidate)
// =============================================================================

async function renderRoute(route) {
  switch (route) {
    case 'overview':
      await renderOverviewView();
      break;
    case 'telemetry':
      await renderTelemetryView();
      break;
    case 'maintenance':
      await renderMaintenanceView();
      break;
    case 'analytics':
      await renderAnalyticsView();
      break;
    case 'staff':
      await renderStaffView();
      break;
    case 'config':
      await renderConfigView();
      break;
    default:
      await renderOverviewView();
      break;
  }
}

function refreshCurrentRoute() {
  renderRoute(currentRoute);
}

// -----------------------------------------------------------------------------
// 1. OVERVIEW VIEW
// -----------------------------------------------------------------------------
async function renderOverviewView() {
  const cacheKey = 'swr_overview_data';

  // Initial Instant Render Callback
  const renderUI = (data) => {
    if (!data) return;
    appRoot.innerHTML = `
      <div class="page-view animate-fade-in">
        <div class="view-header">
          <div>
            <h1 class="view-title">Operations & Facilities Hub</h1>
            <p class="view-subtitle">Real-time facility telemetry, energy distribution, and system alert feed.</p>
          </div>
          <div class="header-actions">
            <button class="btn btn-secondary" id="btn-revalidate-overview">
              <span class="icon">↻</span> Force Refresh
            </button>
            <button class="btn btn-primary" onclick="window.location.hash='#telemetry'">
              <span class="icon">📊</span> Telemetry Matrix
            </button>
          </div>
        </div>

        <!-- Metric KPI Cards -->
        <div class="grid-kpi">
          <div class="card kpi-card">
            <div class="kpi-icon-wrap emerald">
              <span>⚡</span>
            </div>
            <div class="kpi-content">
              <span class="kpi-label">Facility Health Score</span>
              <div class="kpi-value-row">
                <span class="kpi-value text-emerald">${data.facilityHealthScore}%</span>
                <span class="kpi-badge badge-success">Optimal</span>
              </div>
              <span class="kpi-footer">24/24 sensor nodes reporting nominal</span>
            </div>
          </div>

          <div class="card kpi-card">
            <div class="kpi-icon-wrap cyan">
              <span>🌡️</span>
            </div>
            <div class="kpi-content">
              <span class="kpi-label">Average Campus Temperature</span>
              <div class="kpi-value-row">
                <span class="kpi-value text-cyan">${data.averageTemp}°C</span>
                <span class="kpi-badge badge-neutral">Setpoint: 23.0°C</span>
              </div>
              <span class="kpi-footer">Server Room A cooling load: Normal</span>
            </div>
          </div>

          <div class="card kpi-card">
            <div class="kpi-icon-wrap amber">
              <span>💨</span>
            </div>
            <div class="kpi-content">
              <span class="kpi-label">Refrigerant Pressure</span>
              <div class="kpi-value-row">
                <span class="kpi-value text-amber">${data.averagePressure} bar</span>
                <span class="kpi-badge badge-warning">Active Balancer</span>
              </div>
              <span class="kpi-footer">Airflow velocity: 1.85 m/s</span>
            </div>
          </div>

          <div class="card kpi-card">
            <div class="kpi-icon-wrap purple">
              <span>🔌</span>
            </div>
            <div class="kpi-content">
              <span class="kpi-label">Current Power Demand</span>
              <div class="kpi-value-row">
                <span class="kpi-value text-purple">${data.powerDrawTotalKw} kW</span>
                <span class="kpi-badge badge-success">Eco -8.4%</span>
              </div>
              <span class="kpi-footer">Efficiency index: 94.2%</span>
            </div>
          </div>
        </div>

        <!-- Split Grid: Hourly Trend & Realtime Feed -->
        <div class="grid-split mt-4">
          <!-- Canvas Energy Trend Widget -->
          <div class="card p-4">
            <div class="card-header-row">
              <div>
                <h3 class="card-title">Live Energy Load Distribution</h3>
                <span class="card-subtitle">Aggregated kW consumption across monitored rooms</span>
              </div>
              <div class="pill-group">
                <span class="pill active">Today</span>
                <span class="pill" onclick="window.location.hash='#analytics'">Weekly View</span>
              </div>
            </div>
            <div class="chart-container" style="height: 240px; margin-top: 1rem;">
              <canvas id="overview-energy-chart"></canvas>
            </div>
          </div>

          <!-- Live Alert Feed Widget -->
          <div class="card p-4">
            <div class="card-header-row">
              <div>
                <h3 class="card-title">Incident & Threshold Feed</h3>
                <span class="card-subtitle">Automatic triggers based on real-time telemetry</span>
              </div>
              <span class="badge badge-danger">${data.recentAlerts.length} Events</span>
            </div>

            <div class="alert-feed-list mt-3">
              ${data.recentAlerts.map(alt => `
                <div class="alert-feed-item level-${alt.level}">
                  <div class="alert-feed-header">
                    <span class="alert-tag tag-${alt.level}">${alt.level.toUpperCase()}</span>
                    <span class="alert-time">${alt.time}</span>
                  </div>
                  <div class="alert-feed-title">${alt.title}</div>
                  <div class="alert-feed-desc">${alt.message}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    // Render Canvas Chart for Energy Trend
    drawSimpleChart('overview-energy-chart', data.hourlyEnergyTrend.map(d => d.kw), data.hourlyEnergyTrend.map(d => d.time));

    // Attach Force Revalidate button handler
    const btnRefresh = document.getElementById('btn-revalidate-overview');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        showToast('Refreshing Data', 'Fetching latest overview telemetry in background...', 'info');
        swr.execute(cacheKey, () => MockAPI.getOverviewData(), (fresh) => {
          renderUI(fresh);
          showToast('Updated', 'Overview metrics synchronized.', 'success');
        }, { forceFresh: true });
      });
    }
  };

  // SWR: Render cached immediately (if present), fetch in background
  const initial = await swr.execute(
    cacheKey,
    () => MockAPI.getOverviewData(),
    (freshData) => renderUI(freshData)
  );

  if (initial.data) {
    renderUI(initial.data);
  } else {
    // If no cache at all yet (first launch), show a smooth skeleton container
    appRoot.innerHTML = `<div class="skeleton-view animate-fade-in"><div class="skeleton-card" style="height: 180px;"></div><div class="skeleton-card" style="height: 300px; margin-top: 1.5rem;"></div></div>`;
  }
}

// -----------------------------------------------------------------------------
// 2. TELEMETRY MATRIX VIEW
// -----------------------------------------------------------------------------
async function renderTelemetryView() {
  const cacheKey = 'swr_telemetry_nodes';

  const renderUI = (nodes) => {
    if (!nodes) return;

    // Filter nodes
    const filtered = nodes.filter(n => {
      const matchRoom = activeFilters.telemetryRoom === 'all' || n.room === activeFilters.telemetryRoom;
      const matchSearch = !activeFilters.telemetrySearch || 
        n.name.toLowerCase().includes(activeFilters.telemetrySearch.toLowerCase()) ||
        n.room.toLowerCase().includes(activeFilters.telemetrySearch.toLowerCase());
      return matchRoom && matchSearch;
    });

    const uniqueRooms = Array.from(new Set(nodes.map(n => n.room)));

    appRoot.innerHTML = `
      <div class="page-view animate-fade-in">
        <div class="view-header">
          <div>
            <h1 class="view-title">Sensor Telemetry Matrix</h1>
            <p class="view-subtitle">Live hardware registries, temperature telemetry, airflow, and link quality.</p>
          </div>
          <div class="header-actions">
            <span class="live-pill"><span class="dot-green"></span> ${nodes.length} Nodes Online</span>
          </div>
        </div>

        <!-- Filter & Search Toolbar (Instant in-memory filtering) -->
        <div class="filter-toolbar card p-3 mt-2">
          <div class="search-box">
            <span class="search-icon">🔍</span>
            <input type="text" id="telemetry-search" class="input-search" placeholder="Search node name, AC unit, or room..." value="${activeFilters.telemetrySearch}">
          </div>

          <div class="room-pill-list">
            <button class="room-pill ${activeFilters.telemetryRoom === 'all' ? 'active' : ''}" data-room="all">All Rooms (${nodes.length})</button>
            ${uniqueRooms.map(r => `
              <button class="room-pill ${activeFilters.telemetryRoom === r ? 'active' : ''}" data-room="${r}">${r}</button>
            `).join('')}
          </div>
        </div>

        <!-- Telemetry Cards Grid -->
        <div class="grid-nodes mt-4">
          ${filtered.map(node => `
            <div class="card node-card ${node.status === 'warning' ? 'border-warning' : ''}" data-node-id="${node.id}">
              <div class="node-header">
                <div>
                  <span class="node-id">${node.id}</span>
                  <div class="node-name">${node.name}</div>
                  <div class="node-location">📍 ${node.room}</div>
                </div>
                <span class="status-badge status-${node.status}">${node.status.toUpperCase()}</span>
              </div>

              <div class="node-metrics-grid">
                <div class="metric-cell">
                  <span class="metric-label">TEMP</span>
                  <span class="metric-val ${node.temp >= 25 ? 'text-amber' : 'text-emerald'}">${node.temp}°C</span>
                </div>
                <div class="metric-cell">
                  <span class="metric-label">PRESSURE</span>
                  <span class="metric-val text-cyan">${node.pressure} bar</span>
                </div>
                <div class="metric-cell">
                  <span class="metric-label">BATTERY</span>
                  <span class="metric-val text-slate">${node.battery}%</span>
                </div>
                <div class="metric-cell">
                  <span class="metric-label">SIGNAL</span>
                  <span class="metric-val text-slate">${node.rssi} dBm</span>
                </div>
              </div>

              <div class="node-footer">
                <span class="node-type">${node.type}</span>
                <button class="btn-inspect" data-inspect-id="${node.id}">Inspect Node →</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Bind Search Input Handler
    const searchInput = document.getElementById('telemetry-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        activeFilters.telemetrySearch = e.target.value;
        renderUI(nodes);
        const refocused = document.getElementById('telemetry-search');
        if (refocused) {
          refocused.focus();
          refocused.selectionStart = refocused.selectionEnd = refocused.value.length;
        }
      });
    }

    // Bind Room Filter Pills
    document.querySelectorAll('.room-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        activeFilters.telemetryRoom = btn.dataset.room;
        renderUI(nodes);
      });
    });

    // Bind Inspector Drawer
    document.querySelectorAll('.btn-inspect').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.inspectId;
        const node = nodes.find(n => n.id === id);
        if (node) {
          openDrawer(`
            <div class="drawer-header">
              <span class="badge badge-success">${node.status.toUpperCase()}</span>
              <h2 class="drawer-title">${node.name}</h2>
              <div class="text-secondary">Hardware ID: ${node.id} • ${node.room}</div>
            </div>

            <div class="drawer-section mt-4">
              <h4>Telemetry Snapshot</h4>
              <div class="drawer-grid">
                <div class="drawer-kpi"><span class="label">Temperature</span><span class="value text-emerald">${node.temp}°C</span></div>
                <div class="drawer-kpi"><span class="label">Pressure</span><span class="value text-cyan">${node.pressure} bar</span></div>
                <div class="drawer-kpi"><span class="label">RSSI Signal</span><span class="value text-slate">${node.rssi} dBm</span></div>
                <div class="drawer-kpi"><span class="label">Battery Cell</span><span class="value text-slate">${node.battery}%</span></div>
              </div>
            </div>

            <div class="drawer-section mt-4">
              <h4>Air Conditioning Unit Details</h4>
              <p><strong>Appliance:</strong> ${node.type}</p>
              <p><strong>Active Operating Mode:</strong> ${node.mode}</p>
              <p><strong>Campus Location:</strong> ${node.building} • ${node.floor}</p>
            </div>

            <div class="drawer-section mt-4">
              <button class="btn btn-primary w-100" onclick="window.location.hash='#maintenance'">
                Create Maintenance Work Order
              </button>
            </div>
          `);
        }
      });
    });
  };

  const initial = await swr.execute(
    cacheKey,
    () => MockAPI.getTelemetryNodes(),
    (fresh) => renderUI(fresh)
  );

  if (initial.data) {
    renderUI(initial.data);
  } else {
    appRoot.innerHTML = `<div class="skeleton-view animate-fade-in"><div class="skeleton-card" style="height: 100px;"></div><div class="skeleton-card" style="height: 380px; margin-top: 1rem;"></div></div>`;
  }
}

// -----------------------------------------------------------------------------
// 3. MAINTENANCE WORK ORDERS VIEW
// -----------------------------------------------------------------------------
async function renderMaintenanceView() {
  const cacheKey = 'swr_maintenance_orders';

  const renderUI = (orders) => {
    if (!orders) return;

    appRoot.innerHTML = `
      <div class="page-view animate-fade-in">
        <div class="view-header">
          <div>
            <h1 class="view-title">Maintenance Work Orders</h1>
            <p class="view-subtitle">Field service assignments, chemical cleaning, and sensor calibration queues.</p>
          </div>
          <div class="header-actions">
            <button class="btn btn-primary" id="btn-new-order">+ New Work Order</button>
          </div>
        </div>

        <!-- Orders Table / Kanban Hybrid -->
        <div class="card p-4 mt-3">
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Service Task & Unit</th>
                  <th>Assigned Technician</th>
                  <th>Priority</th>
                  <th>Due Date</th>
                  <th>Progress</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${orders.map(ord => `
                  <tr>
                    <td><span class="mono-id">${ord.id}</span></td>
                    <td>
                      <div class="fw-bold">${ord.title}</div>
                      <div class="text-secondary text-sm">📍 ${ord.airconName} (${ord.room})</div>
                    </td>
                    <td>
                      <div class="d-flex align-items-center gap-2">
                        <div class="avatar-mini">${ord.assignedTo.charAt(0)}</div>
                        <span>${ord.assignedTo}</span>
                      </div>
                    </td>
                    <td><span class="badge badge-priority-${ord.priority.toLowerCase()}">${ord.priority}</span></td>
                    <td><span class="text-sm">${ord.dueDate}</span></td>
                    <td>
                      <div class="progress-bar-wrap">
                        <div class="progress-bar-fill" style="width: ${ord.progress}%"></div>
                      </div>
                      <span class="text-xs text-secondary">${ord.progress}% Completed</span>
                    </td>
                    <td>
                      <select class="status-select status-${ord.status.toLowerCase().replace(/\s+/g, '-')}" data-order-id="${ord.id}">
                        <option value="Pending" ${ord.status === 'Pending' ? 'selected' : ''}>Pending</option>
                        <option value="In Progress" ${ord.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                        <option value="For Verification" ${ord.status === 'For Verification' ? 'selected' : ''}>For Verification</option>
                        <option value="Completed" ${ord.status === 'Completed' ? 'selected' : ''}>Completed</option>
                      </select>
                    </td>
                    <td>
                      <button class="btn btn-sm btn-secondary btn-order-inspect" data-order-id="${ord.id}">Inspect</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Status Change Handler with Optimistic SWR Mutation
    document.querySelectorAll('.status-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const orderId = sel.dataset.orderId;
        const newStatus = e.target.value;
        const targetOrder = orders.find(o => o.id === orderId);

        if (newStatus === 'Completed' && targetOrder && targetOrder.tasks && targetOrder.tasks.some(t => !t.done)) {
          showToast('Cannot Complete Order', `Order ${orderId} has unfinished checklist tasks. Complete all tasks first.`, 'warning');
          sel.value = targetOrder.status;
          return;
        }

        const updated = orders.map(o => o.id === orderId ? { ...o, status: newStatus, progress: newStatus === 'Completed' ? 100 : o.progress } : o);
        
        // Optimistic UI update
        swr.mutate(cacheKey, updated, false);
        renderUI(updated);
        showToast('Status Updated', `Order ${orderId} moved to "${newStatus}"`, 'success');
      });
    });

    // Inspect Order Checklist Drawer
    document.querySelectorAll('.btn-order-inspect').forEach(btn => {
      btn.addEventListener('click', () => {
        const ord = orders.find(o => o.id === btn.dataset.orderId);
        if (ord) {
          openDrawer(`
            <div class="drawer-header">
              <span class="badge badge-priority-${ord.priority.toLowerCase()}">${ord.priority} Priority</span>
              <h2 class="drawer-title">${ord.title}</h2>
              <div class="text-secondary">${ord.id} • ${ord.airconName}</div>
            </div>

            <div class="drawer-section mt-4">
              <h4>Service Checklist (${ord.tasks.filter(t => t.done).length}/${ord.tasks.length})</h4>
              <div class="checklist-list mt-2">
                ${ord.tasks.map((task, idx) => `
                  <div class="checklist-item ${task.done ? 'done' : ''}">
                    <input type="checkbox" id="task-${idx}" ${task.done ? 'checked' : ''} class="task-checkbox" data-idx="${idx}">
                    <label for="task-${idx}">${task.name}</label>
                  </div>
                `).join('')}
              </div>
            </div>

            <div class="drawer-section mt-4">
              <p><strong>Assigned Tech:</strong> ${ord.assignedTo}</p>
              <p><strong>Due Timeframe:</strong> ${ord.dueDate}</p>
            </div>
          `);

          // Task toggle inside drawer
          document.querySelectorAll('.task-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
              const idx = parseInt(e.target.dataset.idx, 10);
              ord.tasks[idx].done = e.target.checked;
              const doneCount = ord.tasks.filter(t => t.done).length;
              ord.progress = Math.round((doneCount / ord.tasks.length) * 100);
              swr.mutate(cacheKey, orders, false);
              renderUI(orders);
            });
          });
        }
      });
    });
  };

  const initial = await swr.execute(
    cacheKey,
    () => MockAPI.getMaintenanceOrders(),
    (fresh) => renderUI(fresh)
  );

  if (initial.data) {
    renderUI(initial.data);
  } else {
    appRoot.innerHTML = `<div class="skeleton-view animate-fade-in"><div class="skeleton-card" style="height: 380px;"></div></div>`;
  }
}

// -----------------------------------------------------------------------------
// 4. ANALYTICS & TRENDS VIEW
// -----------------------------------------------------------------------------
async function renderAnalyticsView() {
  const cacheKey = `swr_analytics_${activeFilters.analyticsRange}`;

  const renderUI = (analytics) => {
    if (!analytics) return;

    appRoot.innerHTML = `
      <div class="page-view animate-fade-in">
        <div class="view-header">
          <div>
            <h1 class="view-title">Facility Analytics & Energy Efficiency</h1>
            <p class="view-subtitle">Historical energy draw, cooling compliance rates, and load allocation.</p>
          </div>
          <div class="pill-group">
            <button class="pill ${activeFilters.analyticsRange === '24H' ? 'active' : ''}" data-range="24H">24 Hours</button>
            <button class="pill ${activeFilters.analyticsRange === '7D' ? 'active' : ''}" data-range="7D">7 Days</button>
            <button class="pill ${activeFilters.analyticsRange === '30D' ? 'active' : ''}" data-range="30D">30 Days</button>
          </div>
        </div>

        <div class="grid-kpi mt-3">
          <div class="card kpi-card">
            <div class="kpi-content">
              <span class="kpi-label">Cumulative Energy</span>
              <span class="kpi-value text-emerald">${analytics.energyTotalKwh} kWh</span>
              <span class="kpi-footer">Calculated across all inverter units</span>
            </div>
          </div>
          <div class="card kpi-card">
            <div class="kpi-content">
              <span class="kpi-label">Estimated Savings</span>
              <span class="kpi-value text-cyan">${analytics.energyCostSavings}</span>
              <span class="kpi-footer">Compared to un-optimized baseline</span>
            </div>
          </div>
          <div class="card kpi-card">
            <div class="kpi-content">
              <span class="kpi-label">Uptime Reliability</span>
              <span class="kpi-value text-purple">${analytics.uptimeRatePercent}%</span>
              <span class="kpi-footer">Zero critical downtime recorded</span>
            </div>
          </div>
          <div class="card kpi-card">
            <div class="kpi-content">
              <span class="kpi-label">Setpoint Compliance</span>
              <span class="kpi-value text-amber">${analytics.complianceRatePercent}%</span>
              <span class="kpi-footer">±0.5°C threshold adherence</span>
            </div>
          </div>
        </div>

        <div class="grid-split mt-4">
          <div class="card p-4">
            <h3 class="card-title">Daily Cooling Energy vs Baseline Target (kWh)</h3>
            <div class="chart-container" style="height: 260px; margin-top: 1rem;">
              <canvas id="analytics-trend-chart"></canvas>
            </div>
          </div>

          <div class="card p-4">
            <h3 class="card-title">Load Allocation by Monitored Wing</h3>
            <div class="room-breakdown-list mt-3">
              ${analytics.roomLoadBreakdown.map(item => `
                <div class="breakdown-row">
                  <div class="d-flex justify-content-between mb-1">
                    <span class="fw-bold">${item.room}</span>
                    <span class="fw-bold">${item.loadPercent}%</span>
                  </div>
                  <div class="progress-bar-wrap">
                    <div class="progress-bar-fill" style="width: ${item.loadPercent}%; background-color: ${item.color};"></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    drawSimpleChart('analytics-trend-chart', analytics.dailyTrend.map(d => d.coolingKwh), analytics.dailyTrend.map(d => d.day));

    // Time Range Switcher
    document.querySelectorAll('.pill-group .pill').forEach(btn => {
      btn.addEventListener('click', () => {
        activeFilters.analyticsRange = btn.dataset.range;
        renderAnalyticsView();
      });
    });
  };

  const initial = await swr.execute(
    cacheKey,
    () => MockAPI.getAnalyticsData(activeFilters.analyticsRange),
    (fresh) => renderUI(fresh)
  );

  if (initial.data) {
    renderUI(initial.data);
  } else {
    appRoot.innerHTML = `<div class="skeleton-view animate-fade-in"><div class="skeleton-card" style="height: 360px;"></div></div>`;
  }
}

// -----------------------------------------------------------------------------
// 5. STAFF DIRECTORY VIEW
// -----------------------------------------------------------------------------
async function renderStaffView() {
  const cacheKey = 'swr_staff_directory';

  const renderUI = (staffList) => {
    if (!staffList) return;

    appRoot.innerHTML = `
      <div class="page-view animate-fade-in">
        <div class="view-header">
          <div>
            <h1 class="view-title">Field Staff & Duty Assignments</h1>
            <p class="view-subtitle">Certified technicians, active shifts, and designated facility wings.</p>
          </div>
        </div>

        <div class="grid-staff mt-3">
          ${staffList.map(stf => `
            <div class="card staff-card">
              <div class="staff-card-header">
                <div class="avatar-large" style="background-color: ${stf.avatarColor};">
                  ${stf.name.charAt(0)}
                </div>
                <div class="staff-meta">
                  <div class="staff-name">${stf.name}</div>
                  <div class="staff-role">${stf.role}</div>
                </div>
                <span class="status-pill status-${stf.status.toLowerCase()}">${stf.status}</span>
              </div>

              <div class="staff-details mt-3">
                <div class="detail-line"><strong>📞 Phone:</strong> ${stf.phone}</div>
                <div class="detail-line"><strong>✉️ Email:</strong> ${stf.email}</div>
                <div class="detail-line"><strong>📍 Duty Area:</strong> ${stf.dutyArea}</div>
                <div class="detail-line"><strong>📋 Active Tasks:</strong> ${stf.activeTasks}</div>
              </div>

              <div class="staff-actions mt-3">
                <button class="btn btn-secondary w-100" onclick="alert('Paging technician: ${stf.name}')">
                  Dispatch Page
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  };

  const initial = await swr.execute(
    cacheKey,
    () => MockAPI.getStaffDirectory(),
    (fresh) => renderUI(fresh)
  );

  if (initial.data) {
    renderUI(initial.data);
  } else {
    appRoot.innerHTML = `<div class="skeleton-view animate-fade-in"><div class="skeleton-card" style="height: 280px;"></div></div>`;
  }
}

// -----------------------------------------------------------------------------
// 6. CONFIG & RULES VIEW
// -----------------------------------------------------------------------------
async function renderConfigView() {
  appRoot.innerHTML = `
    <div class="page-view animate-fade-in">
      <div class="view-header">
        <div>
          <h1 class="view-title">System Configuration & Automation Rules</h1>
          <p class="view-subtitle">Adjust telemetry alert thresholds, optimal thermostat setpoints, and diagnostic sensitivity.</p>
        </div>
      </div>

      <div class="grid-split mt-3">
        <div class="card p-4">
          <h3 class="card-title">Thermostat & Inverter Setpoints</h3>
          <div class="config-slider-group mt-3">
            <div class="d-flex justify-content-between">
              <label>Optimal Campus Setpoint</label>
              <span class="fw-bold text-emerald" id="val-optimal">24.0°C</span>
            </div>
            <input type="range" class="range-slider" min="18" max="30" step="0.5" value="24" id="slider-optimal">
          </div>

          <div class="config-slider-group mt-3">
            <div class="d-flex justify-content-between">
              <label>Critical Overheat Threshold</label>
              <span class="fw-bold text-danger" id="val-critical">28.0°C</span>
            </div>
            <input type="range" class="range-slider" min="25" max="35" step="0.5" value="28" id="slider-critical">
          </div>

          <button class="btn btn-primary mt-4" id="btn-save-config">Save Thresholds</button>
        </div>

        <div class="card p-4">
          <h3 class="card-title">SWR Cache & Sync Controls</h3>
          <p class="text-secondary text-sm mt-1">Manage client-side cache persistence and verify stale-while-revalidate behavior.</p>
          <div class="mt-3">
            <button class="btn btn-secondary" id="btn-clear-swr-cache">Purge SWR Local Cache</button>
            <button class="btn btn-primary ml-2" id="btn-simulate-alert">Trigger Test Alert</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Attach Config Sliders
  const sliderOpt = document.getElementById('slider-optimal');
  const valOpt = document.getElementById('val-optimal');
  if (sliderOpt && valOpt) {
    sliderOpt.addEventListener('input', (e) => valOpt.textContent = `${parseFloat(e.target.value).toFixed(1)}°C`);
  }

  const sliderCrit = document.getElementById('slider-critical');
  const valCrit = document.getElementById('val-critical');
  if (sliderCrit && valCrit) {
    sliderCrit.addEventListener('input', (e) => valCrit.textContent = `${parseFloat(e.target.value).toFixed(1)}°C`);
  }

  const btnSave = document.getElementById('btn-save-config');
  if (btnSave) {
    btnSave.addEventListener('click', () => {
      showToast('Configuration Saved', 'Thresholds pushed to live telemetry nodes.', 'success');
    });
  }

  const btnPurge = document.getElementById('btn-clear-swr-cache');
  if (btnPurge) {
    btnPurge.addEventListener('click', () => {
      swr.clear();
      showToast('Cache Purged', 'Local SWR storage has been reset.', 'info');
    });
  }

  const btnSim = document.getElementById('btn-simulate-alert');
  if (btnSim) {
    btnSim.addEventListener('click', () => {
      showToast('⚠️ Critical Hazard Simulation', 'Server Room A temp exceeded 28.5°C threshold!', 'warning');
    });
  }
}

// -----------------------------------------------------------------------------
// HELPER: ZERO-DEPENDENCY CANVAS CHART ENGINE
// -----------------------------------------------------------------------------
function drawSimpleChart(canvasId, values, labels) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const padding = { top: 20, right: 20, bottom: 30, left: 40 };

  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxVal = Math.max(...values, 60) * 1.15;
  const minVal = 0;

  ctx.clearRect(0, 0, width, height);

  // Draw Grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    // Value text
    ctx.fillStyle = '#64748b';
    ctx.font = '10px "JetBrains Mono", monospace';
    const valLabel = Math.round(maxVal - (maxVal / 4) * i);
    ctx.fillText(`${valLabel}`, 10, y + 3);
  }

  // Draw Area Gradient
  const points = values.map((val, idx) => {
    const x = padding.left + (chartW / (values.length - 1)) * idx;
    const y = padding.top + chartH - ((val - minVal) / (maxVal - minVal)) * chartH;
    return { x, y };
  });

  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
  gradient.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
  gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.lineTo(points[points.length - 1].x, padding.top + chartH);
  ctx.lineTo(points[0].x, padding.top + chartH);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Draw Smooth Line
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();

  // Draw Dots & X Labels
  points.forEach((pt, idx) => {
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0b291d';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(labels[idx], pt.x, height - 8);
  });
}

// Initial Boot
const initialHash = window.location.hash.replace('#', '') || 'overview';
navigateTo(initialHash);

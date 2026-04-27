import { drawCandles } from "../shared/chart.js";
import { fetchSinaSuggestions, fetchStockUniverse } from "../shared/market-api.js";
import { ensureDefaults, getState, saveWatchlist } from "../shared/storage.js";
import { applyTheme } from "../shared/ui.js";
import { formatStockCode, inferMarket } from "../shared/utils.js";

const watchlistCards = document.getElementById("watchlistCards");
const watchCount = document.getElementById("watchCount");
const searchModal = document.getElementById("searchModal");
const openSearchBtn = document.getElementById("openSearchBtn");
const closeSearchBtn = document.getElementById("closeSearchBtn");
const watchForm = document.getElementById("watchForm");
const watchCodeInput = document.getElementById("watchCodeInput");
const watchNameInput = document.getElementById("watchNameInput");
const searchResults = document.getElementById("searchResults");
const selectedTitle = document.getElementById("selectedTitle");
const selectedMeta = document.getElementById("selectedMeta");
const selectedScore = document.getElementById("selectedScore");
const metricGrid = document.getElementById("metricGrid");
const matchedRules = document.getElementById("matchedRules");
const missedRules = document.getElementById("missedRules");
const detailCanvas = document.getElementById("detailCanvas");
const headerStatus = document.getElementById("headerStatus");

const _state = {
  bootstrappedRefresh: false,
  selectedCode: null,
  stockUniverse: [],
  selectedSuggestion: null,
};

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

document.getElementById("refreshBtn").addEventListener("click", async () => {
  const refreshRes = await chrome.runtime.sendMessage({ type: "force-refresh" });
  if (!refreshRes?.ok) {
    console.warn("[popup] force-refresh failed:", refreshRes?.error);
  }
  const reviewRes = await chrome.runtime.sendMessage({ type: "run-review" });
  if (!reviewRes?.ok) {
    console.warn("[popup] run-review failed:", reviewRes?.error);
  }
  await render();
});

document.getElementById("openDashboardBtn").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "open-dashboard" });
});

document.getElementById("openOptionsBtn").addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
});

openSearchBtn.addEventListener("click", async () => {
  await loadStockUniverse();
  openSearchModal();
});

watchlistCards.addEventListener("click", async (event) => {
  const deleteBtn = event.target.closest("[data-delete]");
  if (deleteBtn) {
    event.stopPropagation();
    const st = await getState();
    const [market, code] = deleteBtn.dataset.delete.split(":");
    const target = st.watchlist.find((item) => item.market === market && item.code === code);
    if (!confirm(`确认删除「${target?.name || code}」？`)) return;
    const nextWatchlist = st.watchlist.filter((item) => !(item.market === market && item.code === code));
    await saveWatchlist(nextWatchlist);
    if (_state.selectedCode === code) {
      _state.selectedCode = nextWatchlist[0]?.code || null;
    }
    await chrome.runtime.sendMessage({ type: "force-refresh" });
    await chrome.runtime.sendMessage({ type: "run-review" });
    await render();
    return;
  }
  const card = event.target.closest(".stock-card");
  if (card) {
    _state.selectedCode = card.dataset.code;
    await render();
  }
});

searchResults.addEventListener("click", (event) => {
  const item = event.target.closest(".search-item");
  if (!item) return;
  _state.selectedSuggestion = {
    code: item.dataset.code,
    market: item.dataset.market,
    name: item.dataset.name,
  };
  watchCodeInput.value = _state.selectedSuggestion.code;
  watchNameInput.value = _state.selectedSuggestion.name;
  renderSearchResults([]);
});

closeSearchBtn.addEventListener("click", () => {
  closeSearchModal();
});

searchModal.addEventListener("click", (event) => {
  if (event.target === searchModal) {
    closeSearchModal();
  }
});

watchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const st = await getState();
  const suggestion = _state.selectedSuggestion || findExactSuggestion(watchCodeInput.value.trim(), watchNameInput.value.trim());
  if (!suggestion) {
    watchCodeInput.focus();
    return;
  }

  const { code, market, name } = suggestion;
  const existing = st.watchlist.find((item) => item.code === code && item.market === market);
  const nextItem = existing
    ? { ...existing, name }
    : { code, market, name };

  const nextWatchlist = [nextItem, ...st.watchlist.filter((item) => !(item.code === code && item.market === market))];
  await saveWatchlist(nextWatchlist);
  _state.selectedCode = code;
  closeSearchModal();

  await chrome.runtime.sendMessage({ type: "force-refresh" });
  await chrome.runtime.sendMessage({ type: "run-review" });
  await render();
});

watchCodeInput.addEventListener("input", handleSearchInput);
watchNameInput.addEventListener("input", handleSearchInput);

chrome.storage.onChanged.addListener(() => {
  render();
});

render();

async function render() {
  await ensureDefaults();
  const state = await getState();
  applyTheme(state.settings);

  if (!_state.bootstrappedRefresh) {
    _state.bootstrappedRefresh = true;
    _state.stockUniverse = await loadStockUniverse();
    chrome.runtime
      .sendMessage({ type: "soft-refresh" })
      .then(() => chrome.runtime.sendMessage({ type: "run-review" }))
      .then(() => render())
      .catch(() => {});
  }

  if (!_state.selectedCode && state.watchlist[0]) {
    _state.selectedCode = state.watchlist[0].code;
  }

  const latestReport = state.reports?.latest || null;
  watchCount.textContent = `${state.watchlist.length} 只`;
  headerStatus.textContent = buildHeaderStatus(state, latestReport);

  watchlistCards.innerHTML = state.watchlist
    .map((stock) => renderWatchItem(stock, state, latestReport))
    .join("");

  renderSelectedDetail(state, latestReport);
}

function renderWatchItem(stock, state, latestReport) {
  const symbol = `${stock.market}${stock.code}`;
  const quote = state.marketCache?.quotes?.[symbol];
  const reportItem = latestReport?.ranking?.find((item) => item.code === stock.code) || null;
  const totalPossibleScore = latestReport?.totalPossibleScore ?? 0;
  const scoreValue = reportItem?.totalScore ?? "--";
  const scoreClass = Number(scoreValue) >= Math.max(totalPossibleScore * 0.6, 1) ? "up" : "down";
  const activeClass = _state.selectedCode === stock.code ? "active" : "";
  const hasQuote = Boolean(quote && quote.price > 0);
  const price = hasQuote ? Number(quote.price).toFixed(2) : "—";
  const changePct = hasQuote ? Number(quote.changePct || 0) : 0;
  const marketLabel = stock.market === "hk" ? "港股" : stock.market === "bj" ? "北交所" : "A股";
  const positive = changePct >= 0;

  return `
    <article class="stock-card ${activeClass}" data-code="${esc(stock.code)}" data-symbol="${esc(symbol)}">
      <div class="stock-head">
        <div>
          <div class="stock-name">${esc(stock.name)}</div>
          <div class="stock-code">${esc(stock.market.toUpperCase())} ${esc(stock.code)}</div>
        </div>
        <div class="stock-head-right">
          <div class="stock-score ${scoreClass}">
            <span class="num">${esc(scoreValue)}</span>分
          </div>
          <button class="delete-btn" type="button" data-delete="${esc(stock.market)}:${esc(stock.code)}" title="删除自选股">×</button>
        </div>
      </div>
      <div class="stock-mid">
        <div class="stock-price">${esc(price)}</div>
        <span class="badge ${positive ? "up" : "down"}">${positive ? "+" : ""}${changePct.toFixed(2)}%</span>
      </div>
      <div class="stock-tail">
        <span class="stock-foot">${marketLabel}</span>
      </div>
    </article>
  `;
}

function renderSelectedDetail(state, latestReport) {
  const selectedStock = state.watchlist.find((item) => item.code === _state.selectedCode) || state.watchlist[0];
  if (!selectedStock) {
    selectedTitle.textContent = "请先添加自选股";
    selectedMeta.textContent = "当前还没有可复盘的股票";
    selectedScore.textContent = "-- 分";
    selectedScore.className = "score-pill";
    metricGrid.innerHTML = "";
    matchedRules.innerHTML = emptyRuleItem("暂无加分项");
    missedRules.innerHTML = emptyRuleItem("暂无减分项");
    drawCandles(detailCanvas, []);
    return;
  }

  const symbol = `${selectedStock.market}${selectedStock.code}`;
  const quote = state.marketCache?.quotes?.[symbol];
  const history = state.marketCache?.histories?.[symbol] || [];
  const reportItem = latestReport?.ranking?.find((item) => item.code === selectedStock.code) || null;
  const totalPossibleScore = latestReport?.totalPossibleScore ?? 0;
  const hasQuote = Boolean(quote && quote.price > 0);
  const currentPrice = hasQuote ? Number(quote.price) : Number(history.at(-1)?.close || 0);
  const changePct = hasQuote ? Number(quote.changePct || 0) : Number(history.at(-1)?.changePct || 0);

  selectedTitle.textContent = `${selectedStock.name} ${selectedStock.code}`;
  selectedMeta.textContent = reportItem
    ? `复盘得分 ${reportItem.totalScore}/${totalPossibleScore} · 当前价格 ${currentPrice.toFixed(2)}${hasQuote ? "" : "（缓存）"}`
    : hasQuote
      ? "点击「刷新复盘」后自动更新评分"
      : `暂无行情数据 (symbol=${symbol})，请检查网络或重新刷新`;

  if (selectedStock.market === "hk" || selectedStock.market === "bj") {
    selectedMeta.textContent += selectedStock.market === "bj"
      ? " · 北交所行情"
      : " · 港股免费网页行情可能存在延时";
  }

  selectedScore.textContent = `${reportItem?.totalScore ?? "--"} 分`;
  selectedScore.className = `score-pill ${(reportItem?.totalScore ?? 0) >= Math.max(totalPossibleScore * 0.6, 1) ? "up" : "down"}`;

  metricGrid.innerHTML = `
    ${metricCard("现价", currentPrice.toFixed(2))}
    ${metricCard("涨跌幅", `${changePct.toFixed(2)}%`, changePct >= 0 ? "var(--accent-up)" : "var(--accent-down)")}
    ${metricCard("MA5", Number(history.at(-1)?.ma5 || 0).toFixed(2))}
    ${metricCard("BBI", Number(history.at(-1)?.bbi || 0).toFixed(2))}
    ${metricCard("收盘", Number(history.at(-1)?.close || currentPrice).toFixed(2))}
  `;

  matchedRules.innerHTML = reportItem?.matched?.length
    ? reportItem.matched.map((item) => ruleCard(item.ruleName, item.detail, true, item.points)).join("")
    : emptyRuleItem("暂无命中加分项");

  missedRules.innerHTML = reportItem?.missed?.length
    ? reportItem.missed.map((item) => ruleCard(item.ruleName, item.detail, false, item.points)).join("")
    : emptyRuleItem("暂无未命中项");

  drawCandles(detailCanvas, history);
}

function metricCard(label, value, color = "var(--text-main)") {
  return `
    <article class="metric-card">
      <div class="label">${esc(label)}</div>
      <div class="value" style="color:${esc(color)};">${esc(value)}</div>
    </article>
  `;
}

function ruleCard(title, detail, positive, points = 0) {
  return `
    <article class="rule-item">
      <div class="title">${positive ? "+" : "-"}${Number(points || 0)} ${esc(title)}</div>
      <div class="desc">${esc(detail || "无补充说明")}</div>
    </article>
  `;
}

function emptyRuleItem(text) {
  return `<article class="rule-item"><div class="desc">${esc(text)}</div></article>`;
}

function buildHeaderStatus(state, latestReport) {
  const updatedAt = state.marketCache?.lastUpdatedAt;
  const source = state.marketCache?.lastRefreshSource;
  const reviewText = latestReport ? `复盘 ${latestReport.generatedAtText}` : "复盘未生成";
  const sourceText =
    source === "manual"
      ? "手动"
      : source === "auto-15:10"
        ? "15:10"
        : source === "auto-16:15"
          ? "16:15"
          : source === "manual-review"
            ? "复盘"
            : source === "review-reminder"
              ? "提醒"
              : source === "popup-open"
                ? "打开"
                : "缓存";

  if (!updatedAt) {
    return `${reviewText} · 自动 15:10 / 16:15`;
  }

  return `${reviewText} · 更新 ${new Date(updatedAt).toLocaleString()} · ${sourceText}`;
}

async function loadStockUniverse() {
  if (_state.stockUniverse.length) {
    return _state.stockUniverse;
  }
  try {
    _state.stockUniverse = await fetchStockUniverse();
  } catch (error) {
    console.error("Failed to load stock universe", error);
    _state.stockUniverse = [];
  }
  return _state.stockUniverse;
}

async function handleSearchInput() {
  await loadStockUniverse();
  const keyword = `${watchCodeInput.value} ${watchNameInput.value}`.trim();
  _state.selectedSuggestion = null;

  if (!keyword) {
    renderSearchResults([]);
    return;
  }

  const normalized = keyword.replace(/\s+/g, "").toLowerCase();
  const codeKeyword = normalized.replace(/[^0-9]/g, "");
  const remoteSuggestions = await fetchSinaSuggestions(keyword).catch(() => []);
  const localSuggestions = _state.stockUniverse
    .map((item) => ({
      ...item,
      score: getSearchScore(item, normalized, codeKeyword)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));

  const merged = mergeSuggestions(remoteSuggestions, localSuggestions).slice(0, 8);
  renderSearchResults(merged);
}

function renderSearchResults(items) {
  searchResults.innerHTML = items
    .map(
      (item) => `
        <div class="search-item" data-code="${esc(item.code)}" data-market="${esc(item.market)}" data-name="${esc(item.name)}">
          <div>
            <div class="search-name">${esc(item.name)}</div>
            <div class="search-meta">${esc(item.market.toUpperCase())} ${esc(item.code)}</div>
          </div>
          <div class="search-meta">点击选择</div>
        </div>
      `
    )
    .join("");
}

function findExactSuggestion(codeInput, nameInput) {
  const code = formatStockCode(codeInput);
  const name = nameInput.trim();

  if (_state.selectedSuggestion) {
    return _state.selectedSuggestion;
  }

  if (code) {
    return (
      _state.stockUniverse.find((item) => item.code === code && item.market === inferMarket(code)) ||
      _state.stockUniverse.find((item) => item.code === code) ||
      null
    );
  }

  if (name) {
    return _state.stockUniverse.find((item) => item.name === name) || null;
  }

  return null;
}

function getSearchScore(item, normalizedKeyword, codeKeyword) {
  const itemCode = item.code.toLowerCase();
  const itemName = item.name.toLowerCase();
  let score = 0;

  if (codeKeyword) {
    if (itemCode === codeKeyword) {
      score += 120;
    } else if (itemCode.startsWith(codeKeyword)) {
      score += 90;
    } else if (itemCode.includes(codeKeyword)) {
      score += 50;
    }
  }

  if (normalizedKeyword) {
    if (itemName === normalizedKeyword) {
      score += 110;
    } else if (itemName.startsWith(normalizedKeyword)) {
      score += 80;
    } else if (itemName.includes(normalizedKeyword)) {
      score += 45;
    }
  }

  if (item.market === "sh" || item.market === "sz") {
    score += 3;
  }

  return score;
}

function mergeSuggestions(remoteSuggestions, localSuggestions) {
  const result = [];
  const seen = new Set();

  remoteSuggestions.forEach((item, index) => {
    const key = `${item.market}:${item.code}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push({
      ...item,
      score: 1000 - index
    });
  });

  localSuggestions.forEach((item) => {
    const key = `${item.market}:${item.code}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(item);
  });

  return result.sort((a, b) => (b.score || 0) - (a.score || 0));
}

function openSearchModal() {
  searchModal.classList.remove("hidden");
  watchCodeInput.focus();
}

function closeSearchModal() {
  searchModal.classList.add("hidden");
  watchForm.reset();
  _state.selectedSuggestion = null;
  renderSearchResults([]);
}

import { RULE_TYPES } from "../shared/defaults.js";
import {
  ensureDefaults,
  getState,
  saveAlertRules,
  saveScoreRules,
  updateSettings
} from "../shared/storage.js";
import { applyTheme, createRuleParamFields } from "../shared/ui.js";
import { uid, escapeHtml } from "../shared/utils.js";

const settingsForm = document.getElementById("settingsForm");
const holidayForm = document.getElementById("holidayForm");
const holidayList = document.getElementById("holidayList");
const alertRulesList = document.getElementById("alertRulesList");
const scoreRulesList = document.getElementById("scoreRulesList");
let editingAlertRuleId = null;
let editingScoreRuleId = null;

document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
  const formData = new FormData(settingsForm);
  const state = await getState();
  const settings = {
    reviewReminderTime: String(formData.get("reviewReminderTime") || "15:30"),
    refreshIntervalMinutes: Number(formData.get("refreshIntervalMinutes") || 5),
    opacity: Number(formData.get("opacity") || 0.94),
    theme: String(formData.get("theme") || "scarlet"),
    reviewOnlyTradingDays: settingsForm.reviewOnlyTradingDays.checked,
    compactMode: settingsForm.compactMode.checked,
    hidePriceOnBlur: settingsForm.hidePriceOnBlur.checked,
    holidayOverrides: state.settings.holidayOverrides || []
  };
  await updateSettings(settings);
  await render();
});

holidayForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = holidayForm.holidayValue.value.trim();
  if (!value) {
    return;
  }
  const state = await getState();
  const holidayOverrides = Array.from(new Set([...(state.settings.holidayOverrides || []), value]));
  await updateSettings({ holidayOverrides });
  holidayForm.reset();
  await render();
});

render();

async function render() {
  await ensureDefaults();
  const state = await getState();
  applyTheme(state.settings);

  settingsForm.reviewReminderTime.value = state.settings.reviewReminderTime;
  settingsForm.refreshIntervalMinutes.value = state.settings.refreshIntervalMinutes;
  settingsForm.opacity.value = state.settings.opacity;
  settingsForm.theme.value = state.settings.theme;
  settingsForm.reviewOnlyTradingDays.checked = state.settings.reviewOnlyTradingDays;
  settingsForm.compactMode.checked = state.settings.compactMode;
  settingsForm.hidePriceOnBlur.checked = state.settings.hidePriceOnBlur;

  holidayList.innerHTML = (state.settings.holidayOverrides || [])
    .map(
      (item) => `
        <div class="chip">
          <span>${escapeHtml(item)}</span>
          <button class="tiny-btn" data-holiday="${escapeHtml(item)}">删除</button>
        </div>
      `
    )
    .join("");

  holidayList.querySelectorAll("[data-holiday]").forEach((button) => {
    button.addEventListener("click", async () => {
      const nextOverrides = (state.settings.holidayOverrides || []).filter((item) => item !== button.dataset.holiday);
      await updateSettings({ holidayOverrides: nextOverrides });
      await render();
    });
  });

  renderRuleComposer(
    "alertRuleForm",
    "新增预警规则",
    false,
    handleAddAlertRule,
    state.alertRules.find((item) => item.id === editingAlertRuleId)
  );
  renderRuleComposer(
    "scoreRuleForm",
    "新增打分规则",
    true,
    handleAddScoreRule,
    state.scoreRules.find((item) => item.id === editingScoreRuleId)
  );
  renderRuleList(alertRulesList, state.alertRules, false, saveAlertRules, "alert");
  renderRuleList(scoreRulesList, state.scoreRules, true, saveScoreRules, "score");
}

function renderRuleComposer(formId, submitLabel, withPoints, onSubmit, editingRule) {
  const form = document.getElementById(formId);
  form.innerHTML = `
    <div class="rule-card">
      <div class="mini-grid">
        <input name="name" placeholder="规则名称" value="${escapeHtml(editingRule?.name || "")}" required>
        <select name="type">${RULE_TYPES.map((item) => `<option value="${escapeHtml(item.value)}" ${editingRule?.type === item.value ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select>
        ${withPoints ? `<input name="points" type="number" min="0" step="0.5" value="${Number(editingRule?.points ?? 1)}" placeholder="分值">` : ""}
        ${createRuleParamFields(editingRule)}
      </div>
      <div class="rule-row" style="margin-top: 12px;">
        <label class="check-row" style="padding-top: 0;"><input name="enabled" type="checkbox" ${editingRule?.enabled === false ? "" : "checked"}>启用规则</label>
        <button class="solid-btn" type="submit">${editingRule ? "保存修改" : escapeHtml(submitLabel)}</button>
      </div>
    </div>
  `;

  form.onsubmit = async (event) => {
    event.preventDefault();
    await onSubmit(new FormData(form));
  };
}

function buildRuleParams(formData) {
  return {
    period: Number(formData.get("period") || 5),
    threshold: Number(formData.get("threshold") || 0),
    lookback: Number(formData.get("lookback") || 12),
    dropThreshold: Number(formData.get("dropThreshold") || 3),
    volumeRatioThreshold: Number(formData.get("volumeRatioThreshold") || 1.5)
  };
}

async function handleAddAlertRule(formData) {
  const state = await getState();
  const nextRule = {
    id: editingAlertRuleId || uid("alert"),
    name: String(formData.get("name") || "新预警"),
    type: String(formData.get("type")),
    enabled: formData.get("enabled") === "on",
    params: buildRuleParams(formData)
  };
  const nextRules = editingAlertRuleId
    ? state.alertRules.map((rule) => (rule.id === editingAlertRuleId ? nextRule : rule))
    : [nextRule, ...state.alertRules];
  await saveAlertRules(nextRules);
  editingAlertRuleId = null;
  await render();
}

async function handleAddScoreRule(formData) {
  const state = await getState();
  const nextRule = {
    id: editingScoreRuleId || uid("score"),
    name: String(formData.get("name") || "新打分项"),
    type: String(formData.get("type")),
    enabled: formData.get("enabled") === "on",
    points: Number(formData.get("points") || 1),
    params: buildRuleParams(formData)
  };
  const nextRules = editingScoreRuleId
    ? state.scoreRules.map((rule) => (rule.id === editingScoreRuleId ? nextRule : rule))
    : [nextRule, ...state.scoreRules];
  await saveScoreRules(nextRules);
  editingScoreRuleId = null;
  await render();
}

function renderRuleList(container, rules, withPoints, saveFn, mode) {
  container.innerHTML = rules
    .map(
      (rule) => `
        <div class="rule-card">
          <div class="section-head">
            <div>
              <strong>${escapeHtml(rule.name)}</strong>
              <div class="muted">${escapeHtml(RULE_TYPES.find((item) => item.value === rule.type)?.label || rule.type)}</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              ${withPoints ? `<span>${Number(rule.points || 0)} 分</span>` : ""}
              <button class="tiny-btn edit-btn" data-id="${escapeHtml(rule.id)}">编辑</button>
              <button class="tiny-btn toggle-btn" data-id="${escapeHtml(rule.id)}">${rule.enabled ? "停用" : "启用"}</button>
              <button class="tiny-btn delete-btn" data-id="${escapeHtml(rule.id)}">删除</button>
            </div>
          </div>
          <div class="muted">周期 ${Number(rule.params?.period) || "-"} / 阈值 ${Number(rule.params?.threshold) || "-"} / 回看 ${Number(rule.params?.lookback) || "-"} / 阴线跌幅 ${Number(rule.params?.dropThreshold) || "-"} / 放量倍数 ${Number(rule.params?.volumeRatioThreshold) || "-"}</div>
        </div>
      `
    )
    .join("");

  container.querySelectorAll(".edit-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      if (mode === "alert") {
        editingAlertRuleId = button.dataset.id;
      } else {
        editingScoreRuleId = button.dataset.id;
      }
      await render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  container.querySelectorAll(".toggle-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const nextRules = rules.map((rule) =>
        rule.id === button.dataset.id ? { ...rule, enabled: !rule.enabled } : rule
      );
      await saveFn(nextRules);
      await render();
    });
  });

  container.querySelectorAll(".delete-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const nextRules = rules.filter((rule) => rule.id !== button.dataset.id);
      await saveFn(nextRules);
      if (mode === "alert" && editingAlertRuleId === button.dataset.id) {
        editingAlertRuleId = null;
      }
      if (mode === "score" && editingScoreRuleId === button.dataset.id) {
        editingScoreRuleId = null;
      }
      await render();
    });
  });
}

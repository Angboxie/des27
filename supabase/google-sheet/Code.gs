/**
 * DES OPEN CITY 2027 - live registration data in this Google Sheet.
 *
 * Fills four tabs (Summary, Participants, Teams, Payments) from the
 * registration system and refreshes them every five minutes.
 *
 * Set-up (once): Extensions > Apps Script, paste this file, save, reload the
 * sheet, then use the menu  OPEN CITY > Connect.
 *
 * These tabs are overwritten on every refresh, so don't type in them. Put your
 * own notes, charts and formulas on other tabs: they can read from these.
 * To change anything about a registration, use the organisers' dashboard.
 */

var TABS = ['Summary', 'Participants', 'Teams', 'Payments'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('OPEN CITY')
    .addItem('Refresh now', 'refresh')
    .addItem('Connect', 'connect')
    .addItem('Stop automatic refresh', 'disconnect')
    .addToUi();
}

/** Asks for the feed address and secret, stores them out of sight, starts the timer. */
function connect() {
  var ui = SpreadsheetApp.getUi();
  var url = ui.prompt('Feed address', 'https://YOUR-PROJECT.supabase.co/functions/v1/oc-sheet', ui.ButtonSet.OK_CANCEL);
  if (url.getSelectedButton() !== ui.Button.OK) return;
  var token = ui.prompt('Secret', 'The SHEET_TOKEN value. It is stored with the script, not in any cell.', ui.ButtonSet.OK_CANCEL);
  if (token.getSelectedButton() !== ui.Button.OK) return;

  PropertiesService.getScriptProperties().setProperties({
    OC_URL: url.getResponseText().trim(),
    OC_TOKEN: token.getResponseText().trim()
  });

  disconnect();
  ScriptApp.newTrigger('refresh').timeBased().everyMinutes(5).create();
  refresh();
  ui.alert('Connected. The tabs now refresh every five minutes.');
}

function disconnect() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'refresh') ScriptApp.deleteTrigger(trigger);
  });
}

function refresh() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('OC_URL');
  var token = props.getProperty('OC_TOKEN');
  if (!url || !token) throw new Error('Not connected yet. Use OPEN CITY > Connect.');

  var response = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    throw new Error('The registration system answered ' + response.getResponseCode() + '. Check the address and secret.');
  }
  var data = JSON.parse(response.getContentText());
  var book = SpreadsheetApp.getActiveSpreadsheet();

  TABS.forEach(function (name) {
    var rows = (data[name] || []).map(function (row) { return row.map(safeCell); });
    var sheet = book.getSheetByName(name) || book.insertSheet(name);
    sheet.clearContents();
    if (!rows.length) return;
    sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    sheet.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  });

  var stamp = Utilities.formatDate(new Date(), 'Australia/Melbourne', "d MMM yyyy, h:mm a");
  book.getSheetByName('Summary').getRange(1, 4, 1, 2).setValues([['Last updated', stamp]]);
}

/**
 * Text typed by participants (names, team names...) must never run as a
 * formula. Anything starting with = + - or @ gets a leading apostrophe.
 */
function safeCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) return "'" + value;
  return value;
}

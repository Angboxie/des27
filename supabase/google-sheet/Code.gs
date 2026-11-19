/**
 * DES OPEN CITY 2027 - live registration data in this Google Sheet.
 *
 * Fills four tabs (Summary, Participants, Teams, Payments) from the
 * registration system and refreshes them every five minutes.
 *
 * Set-up (once): Extensions > Apps Script, paste this file, save, reload the
 * sheet, then use the menu  OPEN CITY > Connect  and paste the secret.
 *
 * These tabs are overwritten on every refresh, so don't type in them. Put your
 * own notes, charts and formulas on other tabs: they can read from these.
 * To change anything about a registration, use the admin dashboard.
 */

// The registration database. Both values are public (they are in the website too).
var PROJECT_URL = 'https://wrrrgsdazduiiwkuoubz.supabase.co';
var PUBLIC_KEY = 'sb_publishable_J2IeD8u6MTqeJAb-sS4TRg_HAWRPn2A';

var TABS = ['Summary', 'Participants', 'Teams', 'Payments'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('OPEN CITY')
    .addItem('Refresh now', 'refresh')
    .addItem('Connect', 'connect')
    .addItem('Stop automatic refresh', 'disconnect')
    .addToUi();
}

/** Asks for the secret, stores it out of sight (not in any cell), starts the timer. */
function connect() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.prompt('Connect to OPEN CITY registrations', 'Paste the secret for the Google Sheet:', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;

  PropertiesService.getScriptProperties().setProperty('OC_TOKEN', answer.getResponseText().trim());
  disconnect();
  refresh();   // stops here with a message if the secret is wrong
  ScriptApp.newTrigger('refresh').timeBased().everyMinutes(5).create();
  ui.alert('Connected. The tabs now refresh every five minutes.');
}

function disconnect() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'refresh') ScriptApp.deleteTrigger(trigger);
  });
}

function refresh() {
  var token = PropertiesService.getScriptProperties().getProperty('OC_TOKEN');
  if (!token) throw new Error('Not connected yet. Use OPEN CITY > Connect.');

  var response = UrlFetchApp.fetch(PROJECT_URL + '/rest/v1/rpc/oc_sheet_feed', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: PUBLIC_KEY },
    payload: JSON.stringify({ p_token: token }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('Could not read the registrations (' + response.getResponseCode() + '). Check the secret with OPEN CITY > Connect.');
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

  var stamp = Utilities.formatDate(new Date(), 'Australia/Melbourne', 'd MMM yyyy, h:mm a');
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

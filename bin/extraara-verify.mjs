#!/usr/bin/env node
import {
  verifyCertificate,
  verifyBundle,
  MAX_CERTIFICATE_BYTES,
  MAX_DOCUMENT_BYTES,
} from '../src/index.mjs';
import { readRegularFile } from '../src/files.mjs';

const usage = [
  'Usage:',
  '  extraara-verify record RECORD [--document FILE] [--trusted-key SHA256] [--json]',
  '  extraara-verify package MANIFEST RECORD [--document FILE] [--trusted-key SHA256] [--json]',
  '',
  'Inputs are JSON records, JSON package manifests and their original document bytes.',
  'PDF signatures and ZIP archives are not parsed. Extract package files before verification.',
  'No network, account or license is required.',
].join('\n');

function parseArguments(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  const command = args.shift();
  if (!['record', 'package'].includes(command)) throw new Error(usage);
  const files = [];
  const trustedKeyIDs = [];
  let document;
  let json = false;
  while (args.length) {
    const argument = args.shift();
    if (argument === '--json' && !json) {
      json = true;
    } else if (argument === '--document' && document === undefined && args.length) {
      document = args.shift();
    } else if (argument === '--trusted-key' && args.length) {
      const key = args.shift();
      if (
        !/^[a-f0-9]{64}$/.test(key) ||
        trustedKeyIDs.includes(key) ||
        trustedKeyIDs.length >= 256
      ) {
        throw new Error('Expected a distinct lowercase SHA-256 fingerprint.');
      }
      trustedKeyIDs.push(key);
    } else if (!argument.startsWith('-')) {
      files.push(argument);
    } else {
      throw new Error('Unknown, repeated or incomplete option.');
    }
  }
  if (files.length !== (command === 'record' ? 1 : 2)) throw new Error(usage);
  return { command, files, document, trustedKeyIDs, json };
}

function safeJSON(value) {
  return JSON.stringify(value, null, 2).replace(
    /[\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
    (character) => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(safeJSON(result) + '\n');
    return;
  }
  const lines = [
    'Verification: ' + (result.requestedChecksPassed ? 'passed' : 'failed'),
    'Format: ' + (result.format ?? 'unknown or unsupported'),
    'Record integrity: ' + result.recordIntegrity,
    'Document binding: ' + result.documentBinding,
    'Signer trust: ' + result.signerTrust,
    'Human authorship: not established',
    'Trusted time: unavailable',
    'Revocation: not checked',
  ];
  if (result.packageIntegrity) lines.splice(3, 0, 'Package integrity: ' + result.packageIntegrity);
  for (const warning of result.report.warnings) lines.push('Warning: ' + safeJSON(warning));
  for (const error of result.errors) lines.push('Error: ' + safeJSON(error));
  process.stdout.write(lines.join('\n') + '\n');
}

function run() {
  let arguments_;
  try {
    arguments_ = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(error.message + '\n');
    return 64;
  }
  if (arguments_.help) {
    process.stdout.write(usage + '\n');
    return 0;
  }
  const { command, files, document, trustedKeyIDs, json } = arguments_;
  let recordBytes;
  let documentBytes;
  let manifestBytes;
  try {
    recordBytes = readRegularFile(files[command === 'record' ? 0 : 1], MAX_CERTIFICATE_BYTES);
    if (command === 'package') manifestBytes = readRegularFile(files[0], 128 * 1024);
    if (document !== undefined) documentBytes = readRegularFile(document, MAX_DOCUMENT_BYTES);
  } catch {
    const result = {
      requestedChecksPassed: false,
      errors: ['Input unavailable, changed, non-regular or too large.'],
    };
    process.stderr.write(safeJSON(result) + '\n');
    return 66;
  }
  const options = { trustedKeyIDs };
  let result;
  if (command === 'record') {
    const report = verifyCertificate(recordBytes, {
      ...options,
      ...(documentBytes === undefined ? {} : { fileBytes: documentBytes }),
    });
    result = {
      format: report.schemaVersion,
      recordIntegrity: report.integrityValid ? 'valid' : 'invalid',
      documentBinding: report.fileStatus,
      signerTrust: report.signerTrusted ? 'pinned-key' : 'unknown',
      synthetic: report.synthetic,
      requestedChecksPassed: report.isValid,
      errors: [...report.errors],
      report,
    };
  } else {
    const report = verifyBundle(manifestBytes, recordBytes, documentBytes, options);
    result = {
      format: 'extraara-package/0.1',
      packageIntegrity: report.packageIntegrity,
      recordIntegrity: report.recordIntegrity,
      documentBinding: report.documentBinding,
      signerTrust: report.signerTrust,
      synthetic: report.observation.synthetic ?? null,
      requestedChecksPassed:
        report.errors.length === 0 &&
        report.packageIntegrity === 'valid' &&
        report.recordIntegrity === 'valid' &&
        (documentBytes === undefined || report.documentBinding === 'matched'),
      errors: [...report.errors],
      report,
    };
  }
  if (!result.requestedChecksPassed) {
    printResult(result, json);
    return 1;
  }
  if (trustedKeyIDs.length && result.signerTrust !== 'pinned-key') {
    result.requestedChecksPassed = false;
    result.errors.push('Signer does not match the supplied trust pins.');
    printResult(result, json);
    return 2;
  }
  printResult(result, json);
  return 0;
}

process.exitCode = run();

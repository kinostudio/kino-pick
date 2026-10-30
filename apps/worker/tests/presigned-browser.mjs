import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

const close = (server) =>
  new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

export async function verifyBrowserUploadContentLength() {
  let origin;
  let upload;
  let browser;
  let resolveReceived;
  const received = new Promise((resolve) => {
    resolveReceived = resolve;
  });
  try {
    origin = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><title>Upload header fixture</title>');
    });
    const originPort = await listen(origin);
    const originUrl = `http://127.0.0.1:${originPort}`;
    upload = createServer((request, response) => {
      const cors = {
        'Access-Control-Allow-Origin': originUrl,
        'Access-Control-Allow-Methods': 'PUT',
        'Access-Control-Allow-Headers':
          'content-type,if-none-match,x-amz-checksum-sha256',
        Vary: 'Origin',
      };
      if (request.method === 'OPTIONS') {
        response.writeHead(204, cors);
        response.end();
        return;
      }
      let bodyBytes = 0;
      request.on('data', (chunk) => (bodyBytes += chunk.byteLength));
      request.on('end', () => {
        resolveReceived({ headers: request.headers, bodyBytes });
        response.writeHead(200, cors);
        response.end('ok');
      });
    });
    const uploadPort = await listen(upload);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(originUrl);
    const sentLength = await page.evaluate(async (url) => {
      const body = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7])], {
        type: 'image/png',
      });
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/png',
          'If-None-Match': '*',
          'x-amz-checksum-sha256':
            'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        },
        body,
      });
      if (!response.ok)
        throw new Error(`Upload fixture returned ${response.status}`);
      return body.size;
    }, `http://127.0.0.1:${uploadPort}/private/key`);
    const result = await received;
    assert.equal(result.headers['content-length'], String(sentLength));
    assert.equal(result.bodyBytes, sentLength);
  } finally {
    await browser?.close();
    if (origin?.listening) await close(origin);
    if (upload?.listening) await close(upload);
  }
}

import { createServer } from 'node:http';
// Legacy review URLs are aliases only. All product UI and APIs live in target-ui + Worker.
for (const port of [4174]) {
  const server = createServer((req, res) => {
    if (req.headers.host !== '127.0.0.1:' + port) {
      res.writeHead(421);
      res.end();
      return;
    }
    res.writeHead(302, {
      Location: 'http://127.0.0.1:4180/__review/login',
      'Cache-Control': 'no-store',
    });
    res.end();
  });
  server.on('error', (error) => {
    console.error(
      'Legacy review redirect unavailable on port ' + port + ': ' + error.code,
    );
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () =>
    console.log(
      'Legacy review ' +
        port +
        ' redirects to the unified Worker review on4180.',
    ),
  );
}

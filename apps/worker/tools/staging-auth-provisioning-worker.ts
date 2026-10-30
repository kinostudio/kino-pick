// Infrastructure-only placeholder for initial encrypted Secret storage.
// No product code, assets, data bindings, routes or scheduled handlers.
const closedStagingWorker = {
  fetch() {
    return new Response('Staging not released', {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  },
};

export default closedStagingWorker;

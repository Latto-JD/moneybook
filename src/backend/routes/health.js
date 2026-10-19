async function health({ getDb }) {
  let dbStatus = 'ok';
  try {
    const db = await getDb();
    await db.query('select 1');
  } catch (e) {
    dbStatus = 'error';
    console.error('[health] db error:', e.code || e.name);
  }
  return { status: 200, body: { status: 'ok', db: dbStatus } };
}

export const healthRoutes = [{ method: 'GET', path: '/api/health', auth: false, needsDb: false, handler: health }];

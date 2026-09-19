export const testPort = Number(process.env.RBB_TEST_PORT ?? 5173);
export const testUrl = `http://127.0.0.1:${testPort}`;
export const testOrigins = [testUrl, `http://localhost:${testPort}`];

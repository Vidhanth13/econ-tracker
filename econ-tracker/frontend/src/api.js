const j = (url) => fetch(url).then((r) => r.json());
const q = (survey, cls) => `survey=${survey || "cpi"}` + (cls ? `&cls=${cls}` : "");

export const getMonths = (survey, cls) => j(`/api/months?${q(survey, cls)}`);
export const getCategories = (survey, cls) => j(`/api/categories?${q(survey, cls)}`);
export const getTrend = (item, from, to, survey, cls) =>
  j(`/api/trend?item=${item}&from=${from}&to=${to}&${q(survey, cls)}`);
export const getHeadline = (item, survey) =>
  j(`/api/headline?${item ? `item=${item}&` : ""}${q(survey)}`);
export const getMomentum = (item, n = 24, survey, cls) =>
  j(`/api/momentum?${item ? `item=${item}&` : ""}n=${n}&${q(survey, cls)}`);
export const getDrivers = (level = 1, lookback = 1, month = null, survey) =>
  j(`/api/drivers?level=${level ?? 0}&lookback=${lookback}` + (month ? `&month=${month}` : "") + `&${q(survey)}`);
export const getHistory = (item, n = 24, survey, cls) =>
  j(`/api/history?${item ? `item=${item}&` : ""}n=${n}&${q(survey, cls)}`);
export const getNode = (item, lookback = 1, survey = "ppi", cls = "fd") =>
  j(`/api/node?item=${item}&lookback=${lookback}&${q(survey, cls)}`);

// overview helpers for the suite landing page
export const getJoltsOverview = (spark = 24) => j(`/api/jolts/overview?spark=${spark}`);
export const getCesOverview = (spark = 24) => j(`/api/ces/overview?spark=${spark}`);
export const getPceOverview = () => j(`/api/pce/overview`);
export const getCalendar = (country = "USD", impacts = "High,Medium") =>
  j(`/api/calendar?country=${country}&impacts=${impacts}`);

/* Change this copy and palette for all seven shots. Keep four steps and short labels. */
const NOTEBOOK = {
  title: '费曼学习法',
  subtitle: '用“讲给别人听”来学',
  subtitleHighlight: '讲给别人听',
  pageLabel: 'No.07 · 学习方法',
  pageNumber: '— 07 —',
  steps: [
    { head: '选一个概念', highlight: '概念', note: ['比如：', '什么是复利？'] },
    { head: '讲给外行听', highlight: '外行', note: ['不用术语，', '像讲给孩子'] },
    { head: '卡住就重学', highlight: '重学', sticky: ['讲不下去的地方，', '就是你的盲区'] },
    { head: '简化＋打比方', highlight: '打比方', note: ['用比方', '代替术语'] },
  ],
  returnLabel: '回到②，再讲一遍',
  conclusion: ['讲得清楚，', '才是真的懂了。'],
  palette: {
    desk: '#353B48', paper: '#F7F2E7', stack1: '#ECE4D3', stack2: '#DED4C0', dot: '#CBC1AD',
    ink: '#1F2A44', ink2: '#5D6681', mint: '#8ED5BB', butter: '#F5CF66',
    stickyMint: '#D5EEDF', stickyButter: '#FBE5A0', ribbon: '#2B3A5E',
  },
};

/* Original output clock to source scene clock. Includes the held closing frame. */
const SOURCE_TIME = [
  [0, 0],
  [0.15, 0.15],
  [2.6562, 2.4],
  [2.7562, 2.5],
  [5.4005, 5.1],
  [5.5005, 5.2],
  [8.7826, 7.8],
  [8.8826, 7.9],
  [12.4623, 10.5],
  [12.5623, 10.6],
  [16.5435, 13.2],
  [16.6435, 13.3],
  [19.3435, 16],
  [19.9435, 16],
];

function toSourceTime(t) {
  if (t <= 0) return 0;
  for (let i = 1; i < SOURCE_TIME.length; i++) {
    const [nextOut, nextSource] = SOURCE_TIME[i];
    if (t <= nextOut) {
      const [prevOut, prevSource] = SOURCE_TIME[i - 1];
      return prevSource + (nextSource - prevSource) * (t - prevOut) / (nextOut - prevOut);
    }
  }
  return SOURCE_TIME.at(-1)[1];
}

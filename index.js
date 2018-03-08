const {Server, FeedFetcher} = require('topicdeck');

const fetchInterval = 60 * 60 * 1000;
const feedFetcher = new FeedFetcher(fetchInterval, __dirname + '/config/');

const server = new Server({
  assetPathBase: `node_modules/topicdeck/dist/server/`,
  dataPath: `${__dirname}/config/`
}, feedFetcher);

server.start(8080);

const fs = require('fs');
const path = require('path');
const {DepGraph, DepGraphCycleError} = require('dependency-graph');

const validateFeeds = (feeds) => {
  const feedList = Array.from(feeds.values());

  // Build up a simple graph of feeds so we know which order to boot them.
  // If feed A depends on feed B, then we should boot B first.
  const dg = new DepGraph();
  // Our list of servers that we host. We care about these because they need to boot in correct order.
  const hostedOrigins = [];

  for (const config of feedList) {
    hostedOrigins.push(config.feedUrl);
    dg.addNode(config.feedUrl);

    const feeds = config.columns.map(column => column.feedUrl);
    feeds.forEach(feed => {
      dg.addNode(feed);
      dg.addDependency(config.feedUrl, feed);
    });
  }

  // After the graph is loaded, ensure config data is attached.
  // The first time a feed is added to the graph it might not have data.
  for (const config of feedList) {
    dg.setNodeData(config.feedUrl, config);
  }

  // Get the list of feeds in the order we should start them up.
  const orderedConfigs = [];
  try {
    const orderedFeedList = dg.overallOrder().filter(feed => hostedOrigins.indexOf(feed) >= 0);
    orderedFeedList.forEach(feedUrl => orderedConfigs.push(dg.getNodeData(feedUrl)));
    console.log('Dependecy Graph looks fine')
  } catch (err) {
    if (err instanceof DepGraphCycleError) {
      console.error(`Unable to start server, cyclic dependencies found in feed configuration: ${err}`);
      process.exit(-1);
    }
  }
}

const loadConfigs = (basePath) => {
  // Dynamically import the config objects
  const feedConfigs = [];
  console.log('loading config files', basePath);
  const files = fs.readdirSync(basePath, {withFileTypes: true});

  for (const file of files) {
    const filePath = path.join(basePath, file.name);
    if (file.isFile && file.name === 'config.json') {
      console.log(filePath)
      feedConfigs.push(require(filePath));
      continue;
    }
    if (file.isDirectory) {
      feedConfigs.push(...loadConfigs(filePath));
    }
  }
  return feedConfigs;
}

validateFeeds(loadConfigs(path.resolve('./config/')));
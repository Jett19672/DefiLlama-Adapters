const { api } = require("@defillama/sdk");
const { providers } = require("@defillama/sdk/build/general");
const { Contract, BigNumber } = require("ethers");

const abi = require("./abi.json");

const getV2CAs = async (creditFacade, block) => {
  const eventsByDate = [];
  const accounts = new Set();

  const addToEvents = (e, address, operation) => {
    eventsByDate.push({
      time: e.blockNumber * 100000 + e.logIndex,
      address,
      operation,
      ca: e.args.creditAccount ? e.args.creditAccount : null,
      cf: creditFacade,
    });
  };

  const cf = new Contract(
    creditFacade,
    abi["filtersV2"],
    providers["ethereum"]
  );

  const topics = {
    OpenCreditAccount: cf.interface.getEventTopic("OpenCreditAccount"),
    CloseCreditAccount: cf.interface.getEventTopic("CloseCreditAccount"),
    LiquidateCreditAccount: cf.interface.getEventTopic(
      "LiquidateCreditAccount"
    ),
    LiquidateExpiredCreditAccount: cf.interface.getEventTopic(
      "LiquidateExpiredCreditAccount"
    ),
    TransferAccount: cf.interface.getEventTopic("TransferAccount"),
  };

  const logs = (
    await cf.queryFilter(
      {
        address: creditFacade,
        topics: [Object.values(topics)],
      },
      undefined,
      block
    )
  ).map((log) => ({
    ...cf.interface.parseLog(log),
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
  }));

  logs.forEach((log) => {
    switch (log.name) {
      case "OpenCreditAccount":
        addToEvents(log, log.args.onBehalfOf, "add");
        break;
      case "CloseCreditAccount":
      case "LiquidateCreditAccount":
      case "LiquidateExpiredCreditAccount":
        addToEvents(log, log.args.borrower, "delete");
        break;
      case "TransferAccount":
        addToEvents(log, log.args.oldOwner, "delete");
        addToEvents(log, log.args.newOwner, "add");
        break;
    }
  });

  eventsByDate
    .sort((a, b) => {
      return a.time - b.time;
    })
    .forEach((e) => {
      if (e.operation === "add") {
        accounts.add(e.address);
      } else {
        accounts.delete(e.address);
      }
    });

  const openCAs = Array.from(accounts.values()).map(
    (borrower) =>
      logs
        .sort((a, b) => b.blockNumber - a.blockNumber)
        .find((log) => log.args.onBehalfOf && log.args.onBehalfOf === borrower)
        .args.creditAccount
  );

  const { output: totalValue } = await api.abi.multiCall({
    abi: abi["calcTotalValue"],
    calls: openCAs.map((addr) => ({
      target: creditFacade,
      params: [addr],
    })),
    block,
  });

  return totalValue[0]
    ? totalValue
        .map((t) => t.output)
        .reduce((a, c) => a.add(BigNumber.from(c)), BigNumber.from("0"))
        .toString()
    : "0";
};

const getV1CAs = async (creditManager, block) => {
  const eventsByDate = [];
  const accounts = new Set();

  const addToEvents = (e, address, operation) => {
    eventsByDate.push({
      time: e.blockNumber * 100000 + e.logIndex,
      address,
      operation,
    });
  };

  const cm = new Contract(
    creditManager,
    abi["filtersV1"],
    providers["ethereum"]
  );
  const cf = await cm.creditFilter();

  const topics = {
    OpenCreditAccount: cm.interface.getEventTopic("OpenCreditAccount"),
    CloseCreditAccount: cm.interface.getEventTopic("CloseCreditAccount"),
    RepayCreditAccount: cm.interface.getEventTopic("RepayCreditAccount"),
    LiquidateCreditAccount: cm.interface.getEventTopic(
      "LiquidateCreditAccount"
    ),
    TransferAccount: cm.interface.getEventTopic("TransferAccount"),
  };

  const logs = (
    await cm.queryFilter(
      {
        address: creditManager,
        topics: [Object.values(topics)],
      },
      undefined
    )
  ).map((log) => ({
    ...cm.interface.parseLog(log),
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
  }));

  logs.forEach((log) => {
    switch (log.name) {
      case "OpenCreditAccount":
        addToEvents(log, log.args.onBehalfOf, "add");
        break;
      case "CloseCreditAccount":
      case "LiquidateCreditAccount":
      case "RepayCreditAccount":
        addToEvents(log, log.args.borrower, "delete");
        break;
      case "TransferAccount":
        addToEvents(log, log.args.oldOwner, "delete");
        addToEvents(log, log.args.newOwner, "add");
        break;
    }
  });
  eventsByDate
    .sort((a, b) => {
      return a.time - b.time;
    })
    .forEach((e) => {
      if (e.operation === "add") {
        accounts.add(e.address);
      } else {
        accounts.delete(e.address);
      }
    });

  const openCAs = Array.from(accounts.values()).map(
    (borrower) =>
      logs.find(
        (log) => log.args.onBehalfOf && log.args.onBehalfOf === borrower
      ).args.creditAccount
  );

  const { output: totalValue } = await api.abi.multiCall({
    abi: abi["calcTotalValue"],
    calls: openCAs.map((addr) => ({
      target: cf,
      params: [addr],
    })),
    block,
  });

  return totalValue
    .map((t) => t.output)
    .reduce((a, c) => a.add(BigNumber.from(c)), BigNumber.from("0"))
    .toString();
};

module.exports = { getV1CAs, getV2CAs };

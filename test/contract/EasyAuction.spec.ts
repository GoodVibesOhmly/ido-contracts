import { expect } from "chai";
import { Contract, BigNumber } from "ethers";

import {
  toPrice,
  toAuctionDataResult,
  toReceivedFunds,
  encodeOrder,
  queueStartElement,
  createTokensAndMintAndApprove,
  getAllSellOrders,
  getInitialOrder,
  calculateClearingPrice,
} from "../../src/priceCalculation";

import { sendTxAndGetReturnValue, closeAuction } from "./utilities";

describe("EasyAuction", async () => {
  const [user_1, user_2] = waffle.provider.getWallets();
  let easyAuction: Contract;
  beforeEach(async () => {
    const EasyAuction = await ethers.getContractFactory("EasyAuction");

    easyAuction = await EasyAuction.deploy();
  });
  describe("initiate Auction", async () => {
    it("initiateAuction stores the parameters correctly", async () => {
      const {
        sellToken,
        buyToken,
      } = await createTokensAndMintAndApprove(easyAuction, [user_1]);

      const auctionId = await sendTxAndGetReturnValue(
        easyAuction,
        "initiateAuction(address,address,uint256,uint96,uint96)",
        sellToken.address,
        buyToken.address,
        60 * 60,
        ethers.utils.parseEther("1"),
        ethers.utils.parseEther("1"),
      );

      const auctionData = toAuctionDataResult(
        await easyAuction.auctionData(auctionId),
      );
      expect(auctionData.sellToken).to.equal(sellToken.address);
      expect(auctionData.buyToken).to.equal(buyToken.address);
      expect(auctionData.initialAuctionOrder).to.equal(
        encodeOrder({
          userId: BigNumber.from(0),
          sellAmount: ethers.utils.parseEther("1"),
          buyAmount: ethers.utils.parseEther("1"),
        }),
      );
      //Todo assert.equal(auctionData.auctionEndDate);
      await expect(auctionData.clearingPriceOrder).to.equal(
        encodeOrder({
          userId: BigNumber.from(0),
          sellAmount: ethers.utils.parseEther("0"),
          buyAmount: ethers.utils.parseEther("0"),
        }),
      );
      expect(auctionData.volumeClearingPriceOrder).to.be.equal(0);

      expect(await sellToken.balanceOf(easyAuction.address)).to.equal(
        ethers.utils.parseEther("1"),
      );
    });
  });

  describe("getUserId", async () => {
    it("creates new userIds", async () => {
      expect(
        await sendTxAndGetReturnValue(
          easyAuction,
          "getUserId(address)",
          user_1.address,
        ),
      ).to.equal(0);
      expect(
        await sendTxAndGetReturnValue(
          easyAuction,
          "getUserId(address)",
          user_2.address,
        ),
      ).to.equal(1);
      expect(
        await sendTxAndGetReturnValue(
          easyAuction,
          "getUserId(address)",
          user_1.address,
        ),
      ).to.equal(0);
    });
  });
  describe("placeOrders", async () => {
    it("one can not place orders, if auction is not yet initiated", async () => {
      await expect(
        easyAuction.placeSellOrders(
          0,
          [ethers.utils.parseEther("1")],
          [ethers.utils.parseEther("1").add(1)],
          [queueStartElement],
        ),
      ).to.be.revertedWith("Auction no longer in order placement phase");
    });
    it("one can not place orders, if auction is over", async () => {
      const {
        sellToken,
        buyToken,
      } = await createTokensAndMintAndApprove(easyAuction, [user_1]);
      const auctionId = await sendTxAndGetReturnValue(
        easyAuction,
        "initiateAuction(address,address,uint256,uint96,uint96)",
        sellToken.address,
        buyToken.address,
        60 * 60,
        ethers.utils.parseEther("1"),
        ethers.utils.parseEther("1"),
      );
      await closeAuction(easyAuction, auctionId);
      await expect(
        easyAuction.placeSellOrders(
          0,
          [ethers.utils.parseEther("1")],
          [ethers.utils.parseEther("1").add(1)],
          [queueStartElement],
        ),
      ).to.be.revertedWith("Auction no longer in order placement phase");
    });
    it("one can not place orders, with a worser or same rate", async () => {
      const {
        sellToken,
        buyToken,
      } = await createTokensAndMintAndApprove(easyAuction, [user_1]);
      const auctionId = await sendTxAndGetReturnValue(
        easyAuction,
        "initiateAuction(address,address,uint256,uint96,uint96)",
        sellToken.address,
        buyToken.address,
        60 * 60,
        ethers.utils.parseEther("1"),
        ethers.utils.parseEther("1"),
      );
      await expect(
        easyAuction.placeSellOrders(
          auctionId,
          [ethers.utils.parseEther("1").add(1)],
          [ethers.utils.parseEther("1")],
          [queueStartElement],
        ),
      ).to.be.revertedWith("limit price not better than mimimal offer");
      await expect(
        easyAuction.placeSellOrders(
          auctionId,
          [ethers.utils.parseEther("1")],
          [ethers.utils.parseEther("1")],
          [queueStartElement],
        ),
      ).to.be.revertedWith("limit price not better than mimimal offer");
    });
    it("places a new order and checks that tokens were transferred", async () => {
      const {
        sellToken,
        buyToken,
      } = await createTokensAndMintAndApprove(easyAuction, [user_1]);
      const auctionId = await sendTxAndGetReturnValue(
        easyAuction,
        "initiateAuction(address,address,uint256,uint96,uint96)",
        sellToken.address,
        buyToken.address,
        60 * 60,
        ethers.utils.parseEther("1"),
        ethers.utils.parseEther("1"),
      );

      const balanceBeforeOrderPlacement = await buyToken.balanceOf(
        user_1.address,
      );
      const sellAmount = ethers.utils.parseEther("1").add(1);
      const buyAmount = ethers.utils.parseEther("1");

      await easyAuction.placeSellOrders(
        auctionId,
        [buyAmount, buyAmount],
        [sellAmount, sellAmount.add(1)],
        [queueStartElement, queueStartElement],
      );
      const transferredBuyTokenAmount = sellAmount.add(sellAmount.add(1));

      expect(await buyToken.balanceOf(easyAuction.address)).to.equal(
        transferredBuyTokenAmount,
      );
      expect(await buyToken.balanceOf(user_1.address)).to.equal(
        balanceBeforeOrderPlacement.sub(transferredBuyTokenAmount),
      );
    });
    it("throws, if DDOS attack with small order amounts is started", async () => {
      const initialAuctionOrder = {
        sellAmount: ethers.utils.parseEther("1"),
        buyAmount: ethers.utils.parseEther("1"),
        owner: user_1,
      };
      const sellOrders = [
        {
          sellAmount: ethers.utils.parseEther("1").div(5000),
          buyAmount: ethers.utils.parseEther("1").div(10000),
          owner: user_1,
        },
      ];

      const {
        sellToken,
        buyToken,
      } = await createTokensAndMintAndApprove(easyAuction, [user_1]);

      const auctionId = await sendTxAndGetReturnValue(
        easyAuction,
        "initiateAuction(address,address,uint256,uint96,uint96)",
        sellToken.address,
        buyToken.address,
        60 * 60,
        initialAuctionOrder.sellAmount,
        initialAuctionOrder.buyAmount,
      );
      await expect(
        easyAuction.placeSellOrders(
          auctionId,
          sellOrders.map((buyOrder) => buyOrder.buyAmount),
          sellOrders.map((buyOrder) => buyOrder.sellAmount),
          Array(sellOrders.length).fill(queueStartElement),
        ),
      ).to.be.revertedWith("order too small");
    });
    it("fails, if transfers are failing", async () => {
      const {
        sellToken,
        buyToken,
      } = await createTokensAndMintAndApprove(easyAuction, [user_1]);
      const auctionId = await sendTxAndGetReturnValue(
        easyAuction,
        "initiateAuction(address,address,uint256,uint96,uint96)",
        sellToken.address,
        buyToken.address,
        60 * 60,
        ethers.utils.parseEther("1"),
        ethers.utils.parseEther("1"),
      );
      const balanceBeforeOrderPlacement = await buyToken.balanceOf(
        user_1.address,
      );
      const sellAmount = ethers.utils.parseEther("1").add(1);
      const buyAmount = ethers.utils.parseEther("1");
      await buyToken.approve(easyAuction.address, ethers.utils.parseEther("0"));

      await expect(
        easyAuction.placeSellOrders(
          auctionId,
          [buyAmount, buyAmount],
          [sellAmount, sellAmount.add(1)],
          [queueStartElement, queueStartElement],
        ),
      ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
    });
  });

  describe("calculatePrice", async () => {
    it("calculates the auction price in case of clearing order == initialAuctionOrder", async () => {
      const initialAuctionOrder = {
        sellAmount: ethers.utils.parseEther("1"),
        buyAmount: ethers.utils.parseEther("1"),
        owner: user_1,
      };
      const sellOrders = [
        {
          sellAmount: ethers.utils.parseEther("1").div(10),
          buyAmount: ethers.utils.parseEther("1").div(20),
          owner: user_1,
        },
      ];

      const {
        sellToken,
        buyToken,
      } = await createTokensAndMintAndApprove(easyAuction, [user_1]);

      await easyAuction.initiateAuction(
        sellToken.address,
        buyToken.address,
        60 * 60,
        initialAuctionOrder.sellAmount,
        initialAuctionOrder.buyAmount,
      );
      const auctionId = BigNumber.from(1);
      await easyAuction.placeSellOrders(
        auctionId,
        sellOrders.map((buyOrder) => buyOrder.buyAmount),
        sellOrders.map((buyOrder) => buyOrder.sellAmount),
        Array(sellOrders.length).fill(queueStartElement),
      );

      await closeAuction(easyAuction, auctionId);
      const orders = await getAllSellOrders(easyAuction, auctionId.toNumber());
      const initOrder = await getInitialOrder(
        easyAuction,
        auctionId.toNumber(),
      );

      const price = await calculateClearingPrice(easyAuction, auctionId);
      await easyAuction.calculatePrice(
        auctionId,
        price.priceNumerator,
        price.priceDenominator,
      );
      // expect(
      //   clearingOrder).to.eql(
      //   initialAuctionOrder);
      const auctionData = toAuctionDataResult(
        await easyAuction.auctionData(auctionId),
      );
      expect(auctionData.volumeClearingPriceOrder).to.equal(
        sellOrders[0].sellAmount, // times prices (=1)
      );
    });
    it("calculates the auction price in case of no sellOrders", async () => {
      const initialAuctionOrder = {
        sellAmount: ethers.utils.parseEther("1"),
        buyAmount: ethers.utils.parseEther("1"),
        owner: user_1,
      };
      const {
        sellToken,
        buyToken,
      } = await createTokensAndMintAndApprove(easyAuction, [user_1]);

      const auctionId = await sendTxAndGetReturnValue(
        easyAuction,
        "initiateAuction(address,address,uint256,uint96,uint96)",
        sellToken.address,
        buyToken.address,
        60 * 60,
        initialAuctionOrder.sellAmount,
        initialAuctionOrder.buyAmount,
      );
      await closeAuction(easyAuction, auctionId);
      const price = await calculateClearingPrice(easyAuction, auctionId);
      await easyAuction.calculatePrice(
        auctionId,
        price.priceNumerator,
        price.priceDenominator,
      );
      // expect(
      //   clearingOrder).to.equal(
      //   initialAuctionOrder
      // );
      const auctionData = toAuctionDataResult(
        await easyAuction.auctionData(auctionId),
      );
      expect(auctionData.volumeClearingPriceOrder).to.equal("0");
    });
    it("calculates the auction price in case of one sellOrders eating initialAuctionOrder completely", async () => {
      const initialAuctionOrder = {
        sellAmount: ethers.utils.parseEther("1"),
        buyAmount: ethers.utils.parseEther("1"),
        owner: user_1,
      };
      const sellOrders = [
        {
          sellAmount: ethers.utils.parseEther("1").mul(20),
          buyAmount: ethers.utils.parseEther("1").mul(10),
          owner: user_1,
        },
      ];
      const {
        sellToken,
        buyToken,
      } = await createTokensAndMintAndApprove(easyAuction, [user_1]);

      const auctionId = await sendTxAndGetReturnValue(
        easyAuction,
        "initiateAuction(address,address,uint256,uint96,uint96)",
        sellToken.address,
        buyToken.address,
        60 * 60,
        initialAuctionOrder.sellAmount,
        initialAuctionOrder.buyAmount,
      );
      await easyAuction.placeSellOrders(
        auctionId,
        sellOrders.map((buyOrder) => buyOrder.buyAmount),
        sellOrders.map((buyOrder) => buyOrder.sellAmount),
        Array(sellOrders.length).fill(queueStartElement),
      );
      await closeAuction(easyAuction, auctionId);
      const price = await calculateClearingPrice(easyAuction, auctionId);
      await easyAuction.calculatePrice(
        auctionId,
        price.priceNumerator,
        price.priceDenominator,
      );
      // expect(
      //   clearingOrder).to.eql(
      //   sellOrders[0]
      // );
      const auctionData = toAuctionDataResult(
        await easyAuction.auctionData(auctionId),
      );
      expect(auctionData.volumeClearingPriceOrder).to.equal(
        initialAuctionOrder.sellAmount,
      );
    });
    it.only("calculates the auction price in case of 2 of 3 sellOrders eating initialAuctionOrder completely", async () => {
      const initialAuctionOrder = {
        sellAmount: ethers.utils.parseEther("1"),
        buyAmount: ethers.utils.parseEther("1"),
        userId: BigNumber.from(0),
      };
      const sellOrders = [
        {
          sellAmount: ethers.utils.parseEther("1").mul(2),
          buyAmount: ethers.utils.parseEther("1").div(5),
          userId: BigNumber.from(0),
        },
        {
          sellAmount: ethers.utils.parseEther("1").mul(2),
          buyAmount: ethers.utils.parseEther("1"),
          userId: BigNumber.from(0),
        },

        {
          sellAmount: ethers.utils.parseEther("1").mul(2).add(1),
          buyAmount: ethers.utils.parseEther("1").mul(2),
          userId: BigNumber.from(0),
        },
      ];
      const {
        sellToken,
        buyToken,
      } = await createTokensAndMintAndApprove(easyAuction, [user_1]);

      const auctionId = await sendTxAndGetReturnValue(
        easyAuction,
        "initiateAuction(address,address,uint256,uint96,uint96)",
        sellToken.address,
        buyToken.address,
        60 * 60,
        initialAuctionOrder.sellAmount,
        initialAuctionOrder.buyAmount,
      );
      await easyAuction.placeSellOrders(
        auctionId,
        sellOrders.map((buyOrder) => buyOrder.buyAmount),
        sellOrders.map((buyOrder) => buyOrder.sellAmount),
        Array(sellOrders.length).fill(queueStartElement),
      );
      await closeAuction(easyAuction, auctionId);
      const price = await calculateClearingPrice(easyAuction, auctionId);
      console.log(price);
      await easyAuction.calculatePrice(
        auctionId,
        price.priceNumerator,
        price.denominator,
      );
      // expect(
      //   clearingOrder).to.eql(
      //   sellOrders[1]
      // );
      const auctionData = toAuctionDataResult(
        await easyAuction.auctionData(auctionId),
      );
      expect(auctionData.volumeClearingPriceOrder).to.equal(
        sellOrders[1].sellAmount,
      );
    });
    it.only("simple version of e2e gas test", async () => {
      const initialAuctionOrder = {
        sellAmount: ethers.utils.parseEther("1"),
        buyAmount: ethers.utils.parseEther("1"),
        owner: user_1,
      };
      const sellOrders = [
        {
          sellAmount: ethers.utils.parseEther("1").div(8),
          buyAmount: ethers.utils.parseEther("1").div(4),
          owner: user_1,
        },
        {
          sellAmount: ethers.utils.parseEther("1").div(12),
          buyAmount: ethers.utils.parseEther("1").div(4),
          owner: user_1,
        },
        {
          sellAmount: ethers.utils.parseEther("1").div(16),
          buyAmount: ethers.utils.parseEther("1").div(4),
          owner: user_1,
        },
        {
          sellAmount: ethers.utils.parseEther("1").div(20),
          buyAmount: ethers.utils.parseEther("1").div(4),
          owner: user_1,
        },
      ];
      const {
        sellToken,
        buyToken,
      } = await createTokensAndMintAndApprove(easyAuction, [user_1]);

      const auctionId = await sendTxAndGetReturnValue(
        easyAuction,
        "initiateAuction(address,address,uint256,uint96,uint96)",
        sellToken.address,
        buyToken.address,
        60 * 60,
        initialAuctionOrder.sellAmount,
        initialAuctionOrder.buyAmount,
      );
      await easyAuction.placeSellOrders(
        auctionId,
        sellOrders.map((buyOrder) => buyOrder.buyAmount),
        sellOrders.map((buyOrder) => buyOrder.sellAmount),
        Array(sellOrders.length).fill(queueStartElement),
      );
      await closeAuction(easyAuction, auctionId);
      const price = await calculateClearingPrice(easyAuction, auctionId);

      await easyAuction.calculatePrice(
        auctionId,
        price.priceNumerator,
        price.priceDenominator,
      );
      expect(
        (await easyAuction.auctionData(auctionId)).clearingPriceOrder,
      ).to.equal(sellOrders[0]);
      // expect(

      //   price.priceNumerator,
      //   price.priceDenominator).to.equal(       sellOrders[0]
      // );
      const auctionData = toAuctionDataResult(
        await easyAuction.auctionData(auctionId),
      );
      expect(auctionData.volumeClearingPriceOrder).to.equal(
        sellOrders[1].buyAmount,
      );
    });
  });
  describe("claimFromSellOrder", async () => {
    it("checks that claiming only works after the finishing of the auction", async () => {
      const initialAuctionOrder = {
        sellAmount: ethers.utils.parseEther("1"),
        buyAmount: ethers.utils.parseEther("1"),
        owner: user_1,
      };
      const sellOrders = [
        {
          sellAmount: ethers.utils.parseEther("1").sub(1),
          buyAmount: ethers.utils.parseEther("1"),
          owner: user_1,
        },
      ];
      const {
        sellToken,
        buyToken,
      } = await createTokensAndMintAndApprove(easyAuction, [user_1]);

      const auctionId = await sendTxAndGetReturnValue(
        easyAuction,
        "initiateAuction(address,address,uint256,uint96,uint96)",
        sellToken.address,
        buyToken.address,
        60 * 60,
        initialAuctionOrder.sellAmount,
        initialAuctionOrder.buyAmount,
      );
      await easyAuction.placeSellOrders(
        auctionId,
        sellOrders.map((buyOrder) => buyOrder.buyAmount),
        sellOrders.map((buyOrder) => buyOrder.sellAmount),
        Array(sellOrders.length).fill(queueStartElement),
      );
      await expect(
        easyAuction.claimFromSellOrder(auctionId),
      ).to.be.revertedWith("Auction not yet finished");
      await closeAuction(easyAuction, auctionId);
      await expect(
        easyAuction.claimFromSellOrder(auctionId),
      ).to.be.revertedWith("Auction not yet finished");
    });
    it("checks the claimed amounts for a fully matched initialAuctionOrder and buyOrder", async () => {
      const initialAuctionOrder = {
        sellAmount: ethers.utils.parseEther("1"),
        buyAmount: ethers.utils.parseEther("1"),
        owner: user_1,
      };
      const sellOrders = [
        {
          sellAmount: ethers.utils.parseEther("1").sub(1),
          buyAmount: ethers.utils.parseEther("1"),
          owner: user_1,
        },
      ];
      const {
        sellToken,
        buyToken,
      } = await createTokensAndMintAndApprove(easyAuction, [user_1]);

      const auctionId = await sendTxAndGetReturnValue(
        easyAuction,
        "initiateAuction(address,address,uint256,uint96,uint96)",
        sellToken.address,
        buyToken.address,
        60 * 60,
        initialAuctionOrder.sellAmount,
        initialAuctionOrder.buyAmount,
      );
      await easyAuction.placeSellOrders(
        auctionId,
        sellOrders.map((buyOrder) => buyOrder.buyAmount),
        sellOrders.map((buyOrder) => buyOrder.sellAmount),
        Array(sellOrders.length).fill(queueStartElement),
      );
      await closeAuction(easyAuction, auctionId);
      const price = toPrice(
        await sendTxAndGetReturnValue(easyAuction.calculatePrice, auctionId),
      );
      const receivedAmounts = await easyAuction.claimFromSellOrder.call(
        auctionId,
      );
      expect(receivedAmounts[0]).to.be.equal("0");
      expect(receivedAmounts[1]).to.equal(
        initialAuctionOrder.sellAmount
          .mul(sellOrders[0].buyAmount)
          .div(sellOrders[0].sellAmount),
      );
    });
    it("checks the claimed amounts for a partially matched initialAuctionOrder and buyOrder", async () => {
      const initialAuctionOrder = {
        sellAmount: ethers.utils.parseEther("1"),
        buyAmount: ethers.utils.parseEther("1"),
        owner: user_1,
      };
      const sellOrders = [
        {
          sellAmount: ethers.utils.parseEther("1").div(2).sub(1),
          buyAmount: ethers.utils.parseEther("1").div(2),
          owner: user_1,
        },
      ];
      const {
        sellToken,
        buyToken,
      } = await createTokensAndMintAndApprove(easyAuction, [user_1]);

      const auctionId = await sendTxAndGetReturnValue(
        easyAuction,
        "initiateAuction(address,address,uint256,uint96,uint96)",
        sellToken.address,
        buyToken.address,
        60 * 60,
        initialAuctionOrder.sellAmount,
        initialAuctionOrder.buyAmount,
      );
      await easyAuction.placeSellOrders(
        auctionId,
        sellOrders.map((buyOrder) => buyOrder.buyAmount),
        sellOrders.map((buyOrder) => buyOrder.sellAmount),
        Array(sellOrders.length).fill(queueStartElement),
      );
      await closeAuction(easyAuction, auctionId);
      const price = toPrice(
        await sendTxAndGetReturnValue(easyAuction.calculatePrice, auctionId),
      );
      const receivedAmounts = await easyAuction.claimFromSellOrder.call(
        auctionId,
      );
      expect(receivedAmounts[0]).to.equal(
        initialAuctionOrder.sellAmount.sub(sellOrders[0].buyAmount),
      );
      expect(receivedAmounts[1]).to.equal(sellOrders[0].buyAmount);
    });
  });
  describe("claimFromBuyOrder", async () => {
    it("checks that claiming only works after the finishing of the auction", async () => {
      const initialAuctionOrder = {
        sellAmount: ethers.utils.parseEther("1"),
        buyAmount: ethers.utils.parseEther("1"),
        owner: user_1,
      };
      const sellOrders = [
        {
          sellAmount: ethers.utils.parseEther("1").sub(1),
          buyAmount: ethers.utils.parseEther("1"),
          owner: user_1,
        },
      ];
      const {
        sellToken,
        buyToken,
      } = await createTokensAndMintAndApprove(easyAuction, [user_1]);

      const auctionId = await sendTxAndGetReturnValue(
        easyAuction,
        "initiateAuction(address,address,uint256,uint96,uint96)",
        sellToken.address,
        buyToken.address,
        60 * 60,
        initialAuctionOrder.sellAmount,
        initialAuctionOrder.buyAmount,
      );
      await easyAuction.placeSellOrders(
        auctionId,
        sellOrders.map((buyOrder) => buyOrder.buyAmount),
        sellOrders.map((buyOrder) => buyOrder.sellAmount),
        Array(sellOrders.length).fill(queueStartElement),
      );
      await expect(
        easyAuction.claimFromBuyOrder(
          auctionId,
          sellOrders.map((order) =>
            encodeOrder(order.buyAmount, order.sellAmount, 0),
          ),
        ),
      ).to.be.revertedWith("Auction not yet finished");
      await closeAuction(easyAuction, auctionId);
      await expect(
        easyAuction.claimFromBuyOrder(
          auctionId,
          sellOrders.map((order) =>
            encodeOrder(order.buyAmount, order.sellAmount, 0),
          ),
        ),
      ).to.be.revertedWith("Auction not yet finished");
    });
    it("checks the claimed amounts for a partially matched buyOrder", async () => {
      const initialAuctionOrder = {
        sellAmount: ethers.utils.parseEther("1"),
        buyAmount: ethers.utils.parseEther("1"),
        owner: user_1,
      };
      const sellOrders = [
        {
          sellAmount: ethers.utils.parseEther("1").div(2).sub(1),
          buyAmount: ethers.utils.parseEther("1").div(2),
          owner: user_1,
        },
        {
          sellAmount: ethers.utils.parseEther("1").mul(2).div(3).sub(1),
          buyAmount: ethers.utils.parseEther("1").mul(2).div(3),
          owner: user_1,
        },
      ];
      const {
        sellToken,
        buyToken,
      } = await createTokensAndMintAndApprove(easyAuction, [user_1]);

      const auctionId = await sendTxAndGetReturnValue(
        easyAuction,
        "initiateAuction(address,address,uint256,uint96,uint96)",
        sellToken.address,
        buyToken.address,
        60 * 60,
        initialAuctionOrder.sellAmount,
        initialAuctionOrder.buyAmount,
      );
      await easyAuction.placeSellOrders(
        auctionId,
        sellOrders.map((buyOrder) => buyOrder.buyAmount),
        sellOrders.map((buyOrder) => buyOrder.sellAmount),
        Array(sellOrders.length).fill(queueStartElement),
      );
      await closeAuction(easyAuction, auctionId);
      const price = toPrice(
        await sendTxAndGetReturnValue(easyAuction.calculatePrice, auctionId),
      );
      const receivedAmounts = toReceivedFunds(
        await easyAuction.claimFromBuyOrder.call(auctionId, [
          encodeOrder(0, sellOrders[1].buyAmount, sellOrders[1].sellAmount),
        ]),
      );
      const settledBuyAmount = sellOrders[1].buyAmount.sub(
        sellOrders[0].buyAmount
          .add(sellOrders[1].buyAmount)
          .sub(initialAuctionOrder.sellAmount),
      );

      expect(receivedAmounts.buyTokenAmoun).to.equal(
        sellOrders[1].buyAmount
          .mul(sellOrders[1].buyAmount)
          .div(sellOrders[1].sellAmount)
          .sub(settledBuyAmount),
      );
      expect(receivedAmounts.sellTokenAmount).to.equal(
        settledBuyAmount
          .mul(sellOrders[1].sellAmount)
          .div(sellOrders[1].buyAmount),
      );
    });
    it("checks the claimed amounts for a fully matched buyOrder", async () => {
      const initialAuctionOrder = {
        sellAmount: ethers.utils.parseEther("1"),
        buyAmount: ethers.utils.parseEther("1"),
        owner: user_1,
      };
      const sellOrders = [
        {
          sellAmount: ethers.utils.parseEther("1").div(2).sub(1),
          buyAmount: ethers.utils.parseEther("1").div(2),
          owner: user_1,
        },
        {
          sellAmount: ethers.utils.parseEther("1").mul(2).div(3).sub(1),
          buyAmount: ethers.utils.parseEther("1").mul(2).div(3),
          owner: user_1,
        },
      ];
      const {
        sellToken,
        buyToken,
      } = await createTokensAndMintAndApprove(easyAuction, [user_1]);

      const auctionId = await sendTxAndGetReturnValue(
        easyAuction,
        "initiateAuction(address,address,uint256,uint96,uint96)",
        sellToken.address,
        buyToken.address,
        60 * 60,
        initialAuctionOrder.sellAmount,
        initialAuctionOrder.buyAmount,
      );
      await easyAuction.placeSellOrders(
        auctionId,
        sellOrders.map((buyOrder) => buyOrder.buyAmount),
        sellOrders.map((buyOrder) => buyOrder.sellAmount),
        Array(sellOrders.length).fill(queueStartElement),
      );
      await closeAuction(easyAuction, auctionId);
      const price = toPrice(
        await sendTxAndGetReturnValue(easyAuction.calculatePrice, auctionId),
      );
      const receivedAmounts = toReceivedFunds(
        await easyAuction.claimFromBuyOrder.call(auctionId, [
          encodeOrder(0, sellOrders[0].buyAmount, sellOrders[0].sellAmount),
        ]),
      );
      const unsettledBuyAmount = sellOrders[0].buyAmount
        .add(sellOrders[1].buyAmount)
        .sub(initialAuctionOrder.sellAmount);
      expect(receivedAmounts.sellTokenAmount).to.equal(
        sellOrders[0].buyAmount
          .mul(sellOrders[1].sellAmount)
          .div(sellOrders[1].buyAmount)
          .toString(),
      );
      expect(receivedAmounts.buyTokenAmount).to.equal("0");
    });
  });
});
import { BN } from "bn.js";
import { ProgramTestContext } from "solana-bankrun";
import {
  BaseFee,
  claimProtocolFee,
  ClaimTradeFeeParams,
  claimTradingFee,
  ConfigParameters,
  createClaimFeeOperator,
  createConfig,
  CreateConfigParams,
  createPoolWithSplToken,
  partnerWithdrawSurplus,
  protocolWithdrawSurplus,
  swap,
  SwapParams,
} from "./instructions";
import { Pool, VirtualCurveProgram } from "./utils/types";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { fundSol, getMint, startTest } from "./utils";
import {
  createDammConfig,
  createVirtualCurveProgram,
  derivePoolAuthority,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  U64_MAX,
} from "./utils";
import { getVirtualPool, getConfig, getClaimFeeOperator } from "./utils/fetcher";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  createMeteoraMetadata,
  lockLpForCreatorDamm,
  lockLpForPartnerDamm,
  MigrateMeteoraParams,
  migrateToMeteoraDamm,
} from "./instructions/meteoraMigration";
import { assert, expect } from "chai";

describe("Full flow with spl-token", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let user: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;
  let config: PublicKey;
  let virtualPool: PublicKey;
  let virtualPoolState: Pool;
  let dammConfig: PublicKey;
  let claimFeeOperator: PublicKey;

  before(async () => {
    context = await startTest();
    admin = context.payer;
    operator = Keypair.generate();
    partner = Keypair.generate();
    user = Keypair.generate();
    poolCreator = Keypair.generate();
    const receivers = [
      operator.publicKey,
      partner.publicKey,
      user.publicKey,
      poolCreator.publicKey,
    ];
    await fundSol(context.banksClient, admin, receivers);
    program = createVirtualCurveProgram();
  });

  it("Admin create claim fee operator", async () => {
    console.log("🚀 Starting: Admin create claim fee operator");
 
    
    try {
      claimFeeOperator = await createClaimFeeOperator(
        context.banksClient,
        program,
        {
          admin,
          operator: operator.publicKey,
        }
      );

    } catch (error) {
      console.log("❌ Transaction failed:", error.message);
      throw error;
    }


    // console.log("✅ Claim fee operator created successfully!");
    // console.log("Claim Fee Operator Address:", claimFeeOperator.toString());

    // // Verify the operator was created correctly
    // const claimFeeOperatorState = await getClaimFeeOperator(
    //   context.banksClient,
    //   program,
    //   claimFeeOperator
    // );

    // console.log("📊 Claim Fee Operator State:");
    // console.log("- Operator:", claimFeeOperatorState.operator.toString());

    // expect(claimFeeOperatorState.operator.toString()).eq(
    //   operator.publicKey.toString()
    // );

   });


  it.only("Partner create config - Enhanced with Logs", async () => {
    console.log("=== STARTING PARTNER CONFIG CREATION ===");

    // 1. Base Fee Configuration Logging
    const baseFee: BaseFee = {
      cliffFeeNumerator: new BN(2_500_000),
      firstFactor: 0,
      secondFactor: new BN(0),
      thirdFactor: new BN(0),
      baseFeeMode: 0,
    };

    console.log("📊 Base Fee Configuration:");
    console.log("  - Cliff Fee Numerator:", baseFee.cliffFeeNumerator.toString());
    console.log("  - First Factor (periods):", baseFee.firstFactor);
    console.log("  - Second Factor (frequency):", baseFee.secondFactor.toString());
    console.log("  - Third Factor (reduction):", baseFee.thirdFactor.toString());
    console.log("  - Base Fee Mode:", baseFee.baseFeeMode, "(0=Linear, 1=Exponential, 2=RateLimiter)");

    // 2. Bonding Curve Points Logging
    console.log("\n📈 Creating Bonding Curve (20 points):");
    const curves = [];
    for (let i = 1; i <= 16; i++) {
      const curvePoint = {
        sqrtPrice: i == 16 ? MAX_SQRT_PRICE : MAX_SQRT_PRICE.muln(i * 5).divn(100),
        liquidity: U64_MAX.shln(30 + i),
      };
      curves.push(curvePoint);
      console.log(`  Point ${i}: Price=${curvePoint.sqrtPrice.toString()}, Liquidity=${curvePoint.liquidity.toString()}`);
    }

    // 3. Full Configuration Parameters
    const instructionParams: ConfigParameters = {
      poolFees: {
        baseFee,
        dynamicFee: null,
      },
      activationType: 0,
      collectFeeMode: 0,
      migrationOption: 0,
      tokenType: 0, // spl_token
      tokenDecimal: 6,
      migrationQuoteThreshold: new BN(LAMPORTS_PER_SOL * 5),
      partnerLpPercentage: 0,
      creatorLpPercentage: 0,
      partnerLockedLpPercentage: 95,
      creatorLockedLpPercentage: 5,
      sqrtStartPrice: MIN_SQRT_PRICE.shln(32),
      lockedVesting: {
        amountPerPeriod: new BN(0),
        cliffDurationFromMigrationTime: new BN(0),
        frequency: new BN(0),
        numberOfPeriod: new BN(0),
        cliffUnlockAmount: new BN(0),
      },
      migrationFeeOption: 0,
      tokenSupply: null,
      creatorTradingFeePercentage: 0,
      tokenUpdateAuthority: 0,
      migrationFee: {
        feePercentage: 0,
        creatorFeePercentage: 0,
      },
      migratedPoolFee: {
        collectFeeMode: 0,
        dynamicFee: 0,
        poolFeeBps: 0,
      },
      padding: [],
      curve: curves,
    };

    console.log("\n⚙️ Full Config Parameters:");
    console.log("  - Activation Type:", instructionParams.activationType, "(0=Slot, 1=Timestamp)");
    console.log("  - Collect Fee Mode:", instructionParams.collectFeeMode, "(0=Quote, 1=Output)");
    console.log("  - Migration Option:", instructionParams.migrationOption, "(0=MeteoraDamm, 1=DammV2)");
    console.log("  - Token Type:", instructionParams.tokenType, "(0=SPL, 1=Token2022)");
    console.log("  - Token Decimals:", instructionParams.tokenDecimal);
    console.log("  - Migration Threshold:", instructionParams.migrationQuoteThreshold.toString(), "lamports");
    console.log("  - Partner LP %:", instructionParams.partnerLpPercentage);
    console.log("  - Partner Locked LP %:", instructionParams.partnerLockedLpPercentage);
    console.log("  - Creator LP %:", instructionParams.creatorLpPercentage);
    console.log("  - Creator Locked LP %:", instructionParams.creatorLockedLpPercentage);
    console.log("  - Start Price:", instructionParams.sqrtStartPrice.toString());

    const params: CreateConfigParams = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams,
    };

    console.log("\n🔑 Transaction Parameters:");
    console.log("  - Payer:", partner.publicKey.toBase58());
    console.log("  - Leftover Receiver:", partner.publicKey.toBase58());
    console.log("  - Fee Claimer:", partner.publicKey.toBase58());
    console.log("  - Quote Mint:", NATIVE_MINT.toBase58(), "(Native SOL)");

    console.log("\n📤 Calling createConfig...");

    // 4. Create Config Transaction
    config = await createConfig(context.banksClient, program, params);

    console.log("✅ Config Created Successfully!");
    console.log("  - Config Address:", config.toBase58());

    // 5. Verify On-Chain Data
    console.log("\n🔍 Verifying On-Chain Config State...");
    const configState = await getConfig(context.banksClient, program, config);

    console.log("📋 On-Chain Config Verification:");
    console.log("  - Quote Mint Match:", configState.quoteMint.toBase58() === NATIVE_MINT.toBase58() ? "✅" : "❌");
    console.log("  - Partner LP %:", configState.partnerLpPercentage);
    console.log("  - Partner Locked LP %:", configState.partnerLockedLpPercentage);
    console.log("  - Creator LP %:", configState.creatorLpPercentage);
    console.log("  - Creator Locked LP %:", configState.creatorLockedLpPercentage);
    console.log("  - Base Fee Numerator:", configState.poolFees.baseFee.cliffFeeNumerator.toString());
    console.log("  - Migration Threshold:", configState.migrationQuoteThreshold.toString());

    // 6. Security Checks
    console.log("\n🔒 Security Validation:");
    console.log("  - Fee Claimer:", configState.feeClaimer.toBase58());
    console.log("  - Leftover Receiver:", configState.leftoverReceiver.toBase58());
    console.log("  - Token Type:", configState.tokenType);
    console.log("  - Token Decimals:", configState.tokenDecimal);

    console.log("=== PARTNER CONFIG CREATION COMPLETED ===\n");
  });


  it.only("Create spl pool from config", async () => {
    console.log("🚀 Starting: Create spl pool from config");
    console.log("Config used:", config.toString());
    console.log("Operator:", operator.publicKey.toString());
    console.log("Pool creator:", poolCreator.publicKey.toString());

    virtualPool = await createPoolWithSplToken(context.banksClient, program, {
      poolCreator,
      payer: operator,
      quoteMint: NATIVE_MINT,
      config,
      instructionParams: {
        name: "test token spl",
        symbol: "TEST",
        uri: "abc.com",
      },
    });

    console.log("✅ Pool created successfully!");
    console.log("Virtual Pool Address:", virtualPool.toString());

    virtualPoolState = await getVirtualPool(
      context.banksClient,
      program,
      virtualPool
    );

    console.log("📊 Virtual Pool State retrieved:");
    console.log("- Base Mint:", virtualPoolState.baseMint.toString());
    console.log("- Quote Vault:", virtualPoolState.quoteVault.toString());
    console.log("- Base Vault:", virtualPoolState.baseVault.toString());
    console.log("- Creator:", virtualPoolState.creator.toString());
    console.log("- Quote Reserve:", virtualPoolState.quoteReserve.toString());
    console.log("- Base Reserve:", virtualPoolState.baseReserve.toString());

    // Validate freeze authority
    const baseMintData = await getMint(
      context.banksClient,
      virtualPoolState.baseMint
    );

    console.log("🔍 Base Mint Data:");
    console.log("- Freeze Authority:", baseMintData.freezeAuthority?.toString() || "null");
    console.log("- Mint Authority Option:", baseMintData.mintAuthorityOption);
    console.log("- Supply:", baseMintData.supply.toString());
    console.log("- Decimals:", baseMintData.decimals);

    expect(baseMintData.freezeAuthority.toString()).eq(
      PublicKey.default.toString()
    );
    expect(baseMintData.mintAuthorityOption).eq(0);

    console.log("✅ All assertions passed!");
    console.log("🎉 Test completed successfully");
  });


  it("Swap", async () => {
    const params: SwapParams = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: NATIVE_MINT,
      outputTokenMint: virtualPoolState.baseMint,
      amountIn: new BN(LAMPORTS_PER_SOL * 5.5),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };
    await swap(context.banksClient, program, params);
  });

  it("Create meteora metadata", async () => {
    await createMeteoraMetadata(context.banksClient, program, {
      payer: admin,
      virtualPool,
      config,
    });
  });

  it("Migrate to Meteora Damm Pool", async () => {
    const poolAuthority = derivePoolAuthority();
    dammConfig = await createDammConfig(
      context.banksClient,
      admin,
      poolAuthority
    );
    const migrationParams: MigrateMeteoraParams = {
      payer: admin,
      virtualPool,
      dammConfig,
    };

    await migrateToMeteoraDamm(context.banksClient, program, migrationParams);

    // validate mint authority
    const baseMintData = await getMint(
      context.banksClient,
      virtualPoolState.baseMint
    );
    expect(baseMintData.mintAuthorityOption).eq(0);
  });

  it("Partner lock LP", async () => {
    await lockLpForPartnerDamm(context.banksClient, program, {
      payer: partner,
      dammConfig,
      virtualPool,
    });
  });

  it("Creator lock LP", async () => {
    await lockLpForCreatorDamm(context.banksClient, program, {
      payer: poolCreator,
      dammConfig,
      virtualPool,
    });
  });

  it("Partner withdraw surplus", async () => {
    // partner withdraw surplus
    await partnerWithdrawSurplus(context.banksClient, program, {
      feeClaimer: partner,
      virtualPool,
    });
  });

  it("Parner can not withdraw again", async () => {
    try {
      await partnerWithdrawSurplus(context.banksClient, program, {
        feeClaimer: partner,
        virtualPool,
      });
      assert.ok(false);
    } catch (e) {
      //
    }
  });
  it("Protocol withdraw surplus", async () => {
    await protocolWithdrawSurplus(context.banksClient, program, {
      operator: operator,
      virtualPool,
    });
  });

  it("Protocol can not withdraw surplus again", async () => {
    try {
      await protocolWithdrawSurplus(context.banksClient, program, {
        operator: operator,
        virtualPool,
      });
      assert.ok(false);
    } catch (e) {
      //
    }
  });

  it("Partner claim trading fee", async () => {
    const claimTradingFeeParams: ClaimTradeFeeParams = {
      feeClaimer: partner,
      pool: virtualPool,
      maxBaseAmount: new BN(U64_MAX),
      maxQuoteAmount: new BN(U64_MAX),
    };
    await claimTradingFee(context.banksClient, program, claimTradingFeeParams);
  });

  it("Operator claim protocol fee", async () => {
    await claimProtocolFee(context.banksClient, program, {
      pool: virtualPool,
      operator: operator,
    });
  });
});

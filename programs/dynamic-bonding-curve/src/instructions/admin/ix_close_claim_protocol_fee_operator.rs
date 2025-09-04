use anchor_lang::prelude::*;

use crate::{assert_eq_admin, state::ClaimFeeOperator, EvtCloseClaimFeeOperator, PoolError};

#[event_cpi]
#[derive(Accounts)]
pub struct CloseClaimFeeOperatorCtx<'info> {
    #[account(
        mut,
        close = rent_receiver,
    )]
    pub claim_fee_operator: AccountLoader<'info, ClaimFeeOperator>,

    /// CHECK: rent receiver
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,

    #[account(
        constraint = assert_eq_admin(admin.key()) @ PoolError::InvalidAdmin,
    )]
    pub admin: Signer<'info>,
}
//@>q what does close claim mean? nothing but an event?
//@>i only admin can call this
pub fn handle_close_claim_fee_operator(ctx: Context<CloseClaimFeeOperatorCtx>) -> Result<()> {
    //@>i claim_fee_operator close field must be rent_receiver addr
    let claim_fee_operator = ctx.accounts.claim_fee_operator.load()?;
    emit_cpi!(EvtCloseClaimFeeOperator {
        claim_fee_operator: ctx.accounts.claim_fee_operator.key(),
        operator: claim_fee_operator.operator,
    });

    Ok(())
}

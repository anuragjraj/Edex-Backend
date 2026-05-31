// ════════════════════════════════════════════════════════════════
//  ROUTES: SUBSCRIPTION  (mounted at /api/subscription)
// ════════════════════════════════════════════════════════════════
const express = require('express');
const crypto  = require('crypto');
const { db, razorpay } = require('../config/clients');
const { PLANS } = require('../config/constants');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.post('/create-order', verifyToken, async (req, res) => {
  try {
    if (!razorpay) return res.status(503).json({ error: 'Payment not configured' });
    const { planType } = req.body;
    const plan = PLANS[planType];
    if (!plan) return res.status(400).json({ error: 'Invalid plan' });
    const order = await razorpay.orders.create({
      amount: plan.amount, currency: 'INR',
      receipt: `bs_${req.user.id.slice(0, 8)}_${Date.now()}`,
      notes: { userId: req.user.id, planType },
    });
    await db.from('subscriptions').insert({
      user_id: req.user.id, plan_type: planType,
      amount_paise: plan.amount, razorpay_order_id: order.id, status: 'pending',
    });
    res.json({ orderId: order.id, amount: plan.amount, currency: 'INR', planLabel: plan.label });
  } catch (e) { console.error('[create-order]', e); res.status(500).json({ error: 'Could not create payment order.' }); }
});

router.post('/verify', verifyToken, async (req, res) => {
  try {
    if (!razorpay) return res.status(503).json({ error: 'Payment not configured' });
    const { orderId, paymentId, signature, planType } = req.body;
    const expectedSig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`).digest('hex');
    if (expectedSig !== signature) return res.status(400).json({ error: 'Payment verification failed.' });
    const plan = PLANS[planType];
    const exp  = new Date(Date.now() + plan.months * 30 * 24 * 60 * 60 * 1000);
    await db.from('subscriptions').update({
      razorpay_payment_id: paymentId, razorpay_signature: signature,
      status: 'active', starts_at: new Date().toISOString(), expires_at: exp.toISOString(),
    }).eq('razorpay_order_id', orderId);
    await db.from('users').update({
      subscription_status: 'active', subscription_plan: planType, subscription_expires_at: exp.toISOString(),
    }).eq('id', req.user.id);
    res.json({ success: true, expiresAt: exp.toISOString() });
  } catch (e) { console.error('[verify]', e); res.status(500).json({ error: 'Verification error.' }); }
});

module.exports = router;

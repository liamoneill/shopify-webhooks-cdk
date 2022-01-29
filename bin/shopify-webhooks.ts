#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ShopifyWebhooksStack } from '../lib/shopify-webhooks-stack';

const app = new cdk.App();
new ShopifyWebhooksStack(app, 'ShopifyWebhooksStack');

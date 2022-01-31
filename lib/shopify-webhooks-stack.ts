import { Stack, StackProps } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { KinesisFirehoseToS3 } from '@aws-solutions-constructs/aws-kinesisfirehose-s3';
import { Construct } from 'constructs';

export class ShopifyWebhooksStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const firehose = new KinesisFirehoseToS3(this, 'shopify-events-firehose', {
      bucketProps: {
        bucketName: 'shopify-events.liamoneill.net',
        encryption: s3.BucketEncryption.S3_MANAGED,
        // blockPublicAccess: new s3.BlockPublicAccess({
        //   blockPublicAcls: true,
        //   blockPublicPolicy: true
        // })
      },
      kinesisFirehoseProps: {
        deliveryStreamName: "shopify-events.liamoneill.net",
        deliveryStreamType: "DirectPut",
        extendedS3DestinationConfiguration: {
          bufferingHints: {
            intervalInSeconds: 5 * 60,
            sizeInMBs: 5
          }
        }
      }
    });

    const secret = new secretsmanager.Secret(this, 'shopify-events-webhook-secret', {
      secretName: "shopify-events.liamoneill.net"
    });

    const lambdaFunction = new lambda.Function(this, 'shopify-events-lambda', {
      runtime: lambda.Runtime.NODEJS_14_X,
      code: lambda.Code.fromAsset('resources'),
      handler: 'shopify-events.main',
      environment: {
        SECRET_NAME: secret.secretName,
        DELIVERY_STREAM: firehose.kinesisFirehose.deliveryStreamName!
      },
      initialPolicy: [
        // Firehose's resource doesn't have any `grant*` helpers
        //    so we have to fall back to creating IAM statements ourselves.
        new iam.PolicyStatement({
          actions: [
            "firehose:PutRecord",
            "firehose:PutRecordBatch",
          ],
          resources: [
            firehose.kinesisFirehose.attrArn
          ]
        })
      ]
    });

    // Secret resources however do have the iam helper functions.
    secret.grantRead(lambdaFunction);

    const apiGateway = new apigateway.LambdaRestApi(this, 'shopify-events-apigateway', {
      handler: lambdaFunction,
    });
  }
}

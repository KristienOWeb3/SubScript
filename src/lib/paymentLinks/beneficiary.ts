import { ethers } from "ethers";

export type BeneficiaryValidation =
    | { ok: true; address: string | null }
    | { ok: false; error: string };

export function validateBeneficiaryAddress(
    value: unknown,
    merchantAddress: string,
): BeneficiaryValidation {
    if (value === undefined || value === null || value === "") {
        return { ok: true, address: null };
    }

    if (typeof value !== "string" || !ethers.isAddress(value)) {
        return { ok: false, error: "Bad Request: beneficiary_address must be a valid wallet address" };
    }

    const address = value.toLowerCase();
    if (address === merchantAddress.toLowerCase()) {
        return {
            ok: false,
            error: "Bad Request: A merchant cannot be the beneficiary of its own payment link",
        };
    }

    return { ok: true, address };
}

export function resolveFulfillmentAddress(
    beneficiaryAddress: string | null | undefined,
    payerAddress: string,
) {
    return (beneficiaryAddress || payerAddress).toLowerCase();
}

export function paymentIdentityMetadata(
    payerAddress: string,
    beneficiaryAddress: string,
) {
    const payer = payerAddress.toLowerCase();
    const beneficiary = beneficiaryAddress.toLowerCase();

    return {
        payer_address: payer,
        payerAddress: payer,
        beneficiary_address: beneficiary,
        beneficiaryAddress: beneficiary,
    };
}

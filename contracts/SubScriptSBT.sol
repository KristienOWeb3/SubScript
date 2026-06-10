/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/*
IERC4906 Interface for metadata updates
*/
interface IERC4906 {
    event MetadataUpdate(uint256 _tokenId);
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
}

contract SubScriptSBT is ERC721, Ownable, IERC4906 {
    /* Token ID tracking */
    uint256 private _tokenIdCounter;

    /* Base URI for metadata */
    string private _baseTokenURI;

    /* Bidirectional mappings between tokenId and subscriptionId */
    mapping(uint256 => uint256) public tokenToSubscriptionId;
    mapping(uint256 => uint256) public subscriptionToTokenId;

    /* Constructor passing initial owner */
    constructor(address initialOwner, string memory baseURI_) ERC721("SubScript Soulbound Access Token", "SUB-SBT") Ownable(initialOwner) {
        _baseTokenURI = baseURI_;
    }

    /* Override base URI */
    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    /* Set Base URI (owner only) */
    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        _baseTokenURI = newBaseURI;
        emit BatchMetadataUpdate(1, _tokenIdCounter);
    }

    /* Soulbound behavior: revert on all transfer paths */
    function transferFrom(address /* from */, address /* to */, uint256 /* tokenId */) public override {
        revert("SBT: Transfers are disabled");
    }

    function safeTransferFrom(address /* from */, address /* to */, uint256 /* tokenId */, bytes memory /* data */) public override {
        revert("SBT: Transfers are disabled");
    }

    /* Overridden approval paths: revert on approvals */
    function approve(address /* to */, uint256 /* tokenId */) public override {
        revert("SBT: Approvals are disabled");
    }

    function setApprovalForAll(address /* operator */, bool /* approved */) public override {
        revert("SBT: Approvals are disabled");
    }

    /* ERC-721 Hook Override for transfer control in OZ v5 */
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address previousOwner = super._update(to, tokenId, auth);
        if (previousOwner != address(0) && to != address(0)) {
            revert("SBT: Soulbound token cannot be transferred");
        }
        return previousOwner;
    }

    /* Minting soulbound token */
    function mint(address to, uint256 subscriptionId) external onlyOwner returns (uint256) {
        require(to != address(0), "SBT: Cannot mint to zero address");
        require(subscriptionToTokenId[subscriptionId] == 0, "SBT: Token already minted for subscription");

        _tokenIdCounter++;
        uint256 newTokenId = _tokenIdCounter;

        /* Set bidirectional mappings */
        tokenToSubscriptionId[newTokenId] = subscriptionId;
        subscriptionToTokenId[subscriptionId] = newTokenId;

        _safeMint(to, newTokenId);

        return newTokenId;
    }

    /* Burning soulbound token (bidirectional cleanup) */
    function burn(uint256 tokenId) external onlyOwner {
        uint256 subscriptionId = tokenToSubscriptionId[tokenId];
        
        /* Bidirectional cleanup */
        if (subscriptionId != 0) {
            delete subscriptionToTokenId[subscriptionId];
        }
        delete tokenToSubscriptionId[tokenId];

        _burn(tokenId);

        emit MetadataUpdate(tokenId);
    }

    /* Refresh metadata event trigger */
    function refreshMetadata(uint256 tokenId) external onlyOwner {
        require(_ownerOf(tokenId) != address(0), "SBT: Token does not exist");
        emit MetadataUpdate(tokenId);
    }

    /* Interface support mapping */
    function supportsInterface(bytes4 interfaceId) public view override(ERC721) returns (bool) {
        return interfaceId == 0x49064906 || super.supportsInterface(interfaceId);
    }
}

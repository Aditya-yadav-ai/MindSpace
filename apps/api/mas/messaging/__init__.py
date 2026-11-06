"""Agent-to-agent messaging (P2P) primitives."""

from mas.messaging.p2p import (
    DeliveryFailureError,
    DuplicateMessageError,
    MalformedMessageError,
    P2PError,
    P2PMailbox,
    UnknownPeerError,
    UnknownRecipientError,
    UnknownSenderError,
    get_mailbox,
    reset_mailbox,
)

__all__ = [
    "DeliveryFailureError",
    "DuplicateMessageError",
    "MalformedMessageError",
    "P2PError",
    "P2PMailbox",
    "UnknownPeerError",
    "UnknownRecipientError",
    "UnknownSenderError",
    "get_mailbox",
    "reset_mailbox",
]

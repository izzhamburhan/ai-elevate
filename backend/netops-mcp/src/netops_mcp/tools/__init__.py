from netops_mcp.tools import bins, boundaries, nba, network, places, ran, subscriber, tickets

ALL_TOOLS = [*network.TOOLS, *bins.TOOLS, *subscriber.TOOLS, *nba.TOOLS, *tickets.TOOLS, *ran.TOOLS, *places.TOOLS,
             *boundaries.TOOLS]

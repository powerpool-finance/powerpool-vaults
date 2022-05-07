contract VotingEscrowMock {
  address public token;

  constructor(address _token) {
    token = _token;
  }
}

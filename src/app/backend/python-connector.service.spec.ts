import { TestBed } from '@angular/core/testing';

import { PythonConnectorService } from './python-connector.service';

describe('PythonConnectorService', () => {
  let service: PythonConnectorService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PythonConnectorService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
